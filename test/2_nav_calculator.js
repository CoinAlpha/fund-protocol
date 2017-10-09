const Promise = require('bluebird');

const Fund = artifacts.require('./Fund.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');
const DataFeed = artifacts.require('./DataFeed.sol');

const { increaseTime, sendTransaction } = require('../js/helpers');

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

contract('NavCalculator', (accounts) => {
  let MANAGER = accounts[0];
  let EXCHANGE = accounts[1];
  const GAS_AMT = 500000;
  const MGMT_FEE_BPS = 100;
  const SECONDS_IN_YEAR = 31536000;
  const PERFORM_FEE_BPS = 2000;
  const TIMEDIFF = 31536000;

  let fund, calculator, dataFeed;
  let totalSupply, totalEthPendingSubscription, totalEthPendingWithdrawal, navPerShare, accumulatedMgmtFees, accumulatedPerformFees, lossCarryforward, usdEth;

  // Helpers
  const getBalancePromise = address => web3.eth.getBalancePromise(address);
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToUsd = (eth) => eth * usdEth / 1e20;
  const usdToEth = (usd) => usd * 1e20 / usdEth;
  
  const changeExchangeValue = (_multiplier) => {
    return new Promise((resolve, reject) => {
      resolve(
        dataFeed.updateWithExchange(_multiplier)
          .then(() => dataFeed.value())
          .then((_val) => console.log("new exchange value:", weiToNum(_val)))
      );
    });
  };

  const retrieveFundParams = () => Promise.all([
    fund.lastCalcDate.call(),
    fund.navPerShare.call(),
    fund.lossCarryforward.call(),
    fund.accumulatedMgmtFees.call(),
    fund.accumulatedPerformFees.call()
  ]);

  const checkRoughEqual = (vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees) => {
    [ansNAV, ansLCF, ansAMF, ansAPF] = vals;
    // console.log('navPerShare', parseInt(navPerShare));
    // console.log('ansNAV', ansNAV);
    assert(Math.abs(parseInt(navPerShare) / ansNAV - 1) < 0.0001, 'incorrect navPerShare');

    if (ansLCF !== 0) assert(Math.abs(parseInt(lossCarryforward) / ansLCF - 1) < 0.0001, 'incorrect lossCarryforward');
    else assert.equal(parseInt(lossCarryforward), 0, 'incorrect lossCarryforward');

    if (ansAMF !== 0) assert(Math.abs(parseInt(accumulatedMgmtFees) / ansAMF - 1) < 0.0001, 'incorrect accumulatedMgmtFees');
    else assert.equal(parseInt(accumulatedMgmtFees), 0, 'incorrect accumulatedMgmtFees');
    if (ansAPF !== 0) assert(Math.abs(parseInt(accumulatedPerformFees) / ansAPF - 1) < 0.0001, 'incorrect accumulatedPerformFees');
    else assert.equal(parseInt(accumulatedPerformFees), 0, 'incorrect accumulatedPerformFees');
  };

  const calc = (elapsedTime) => {
    return new Promise((resolve, reject) => {
      let fundBal, portfolioValueUsd, ts;
      Promise.all([dataFeed.value(), fund.getBalance(), fund.totalSupply()])
        .then((_vals) => {
          [portfolioValueUsd, fundBal, ts] = _vals;
          let gav = parseInt(portfolioValueUsd) + ethToUsd(parseInt(fundBal));
          // console.log('gav', gav);
          let nav = ts * navPerShare / 10000;
          // console.log('nav', nav);
          let mgmtFee = Math.trunc(navPerShare * MGMT_FEE_BPS / 10000 * elapsedTime / SECONDS_IN_YEAR * ts / 10000);
          // console.log('mgmtFee', mgmtFee);
          let gpvlessFees = gav - accumulatedMgmtFees - accumulatedPerformFees;
          // console.log('gpvlessFees', gpvlessFees);
          let gainLoss = gpvlessFees - nav - mgmtFee;
          // console.log('gainLoss', gainLoss);
          let lossPayback = gainLoss > 0 ? Math.min(gainLoss, lossCarryforward) : 0;
          // console.log('lossPayback', lossPayback);
          let gainLossAfterPayback = gainLoss - lossPayback;
          // console.log('gainLossAfterPayback', gainLossAfterPayback);
          let performFee = gainLossAfterPayback > 0 ? Math.trunc(gainLossAfterPayback * PERFORM_FEE_BPS / 10000) : 0;
          // console.log('performFee', performFee);
          let netGainLossAfterPerformFee = gainLossAfterPayback + lossPayback - performFee;
          // console.log('netGainLossAfterPerformFee', netGainLossAfterPerformFee);
          nav += netGainLossAfterPerformFee;
          if (netGainLossAfterPerformFee < 0) lossCarryforward += Math.abs(netGainLossAfterPerformFee);

          navPerShare = Math.trunc(nav * 10000 / totalSupply);
          lossCarryforward -= lossPayback;
          accumulatedMgmtFees += mgmtFee;
          accumulatedPerformFees += performFee;
          resolve([navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees]);
        })
        .catch(reject);
    });
  }

  before(() => {
    return Promise.all([Fund.deployed(), NavCalculator.deployed(), DataFeed.deployed()])
      .then(_values => {
        [fund, navCalculator, dataFeed] = _values;
        return navCalculator.setFund(fund.address)
      })
      .then(() => {
        return Promise.all([
          fund.totalSupply(),
          fund.totalEthPendingSubscription(),
          fund.totalEthPendingWithdrawal(),
          fund.accumulatedMgmtFees(),
          fund.accumulatedPerformFees(),
          fund.lossCarryforward(),
          dataFeed.usdEth(),
        ]);
      })
      .then((_vals) => {
        [totalSupply, totalEthPendingSubscription, totalEthPendingWithdrawal,
          accumulatedMgmtFees, accumulatedPerformFees, lossCarryforward, usdEth] = _vals.map(parseInt);
        totalEthPendingSubscription = totalEthPendingSubscription || 0;
        return fund.navPerShare();
      })
      .then((_navPerShare) => navPerShare = _navPerShare)
      .catch(console.error);
  });

  it('should set fund to the correct fund address', (done) => {
    navCalculator.setFund(fund.address)
      .then(() => {
        return navCalculator.fundAddress.call();
      })
      .then((_fund_addr) => {
        assert.equal(_fund_addr, fund.address, 'fund addresses don\'t match');
        done();
      });
  });

  it('should set value feed to the correct data feed address', (done) => {
    navCalculator.setDataFeed(dataFeed.address)
      .then(() => {
        return navCalculator.dataFeed.call()
      })
      .then((_val_addr) => {
        assert.equal(_val_addr, dataFeed.address, 'data feed addresses don\'t match');
        done();
      })
  });

  it('should calculate the navPerShare correctly (base case)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    fund.lastCalcDate.call()
      .then(_date => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });

  it('should calculate the navPerShare correctly (portfolio goes down)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    Promise.resolve(changeExchangeValue(75))
      .then(() => fund.lastCalcDate.call())
      .then(_date => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });


  it('should calculate the navPerShare correctly (portfolio recovers from loss)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    Promise.resolve(changeExchangeValue(150))
      .then(() => fund.lastCalcDate.call())
      .then((_date) => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });

  it('should calculate the navPerShare correctly (portfolio loses its gains)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    Promise.resolve(changeExchangeValue(25))
      .then(() => fund.lastCalcDate.call())
      .then(_date => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });

  it('should calculate the navPerShare correctly (portfolio goes up 50x)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    Promise.resolve(changeExchangeValue(5000))
      .then(() => fund.lastCalcDate.call())
      .then(_date => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });

  it('should calculate the navPerShare correctly (portfolio goes to 0)', (done) => {
    let date1, date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees;

    Promise.resolve(changeExchangeValue(0))
      .then(() => fund.lastCalcDate.call())
      .then(_date => date1 = _date)
      .then(() => Promise.resolve(increaseTime(TIMEDIFF)))
      .then(() => fund.calcNav())
      .then(() => retrieveFundParams())
      .then((_values) => {
        [date2, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees] = _values;
        assert(date2 - date1 >= TIMEDIFF, 'timelapse error');
        return calc(date2 - date1);
      })
      .then((_vals) => {
        checkRoughEqual(_vals, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
        done();
      })
      .catch(console.error);
  });
});
