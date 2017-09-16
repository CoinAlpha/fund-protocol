const DataFeed = artifacts.require('./DataFeed.sol');
const Fund = artifacts.require('./Fund.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');

/*
  Test contract behavior when there is a large lists of investors.
  To customize the number of investors, run `testrpc -b 1 -a <NUM_OF_INVESTORS>`
  To customize testrpc gas limit, run `testrpc -b 1 -l <GAS_LIMIT_IN_HEX>`

  Default # of investor accounts:         10
  Default gas limit:                      0x47E7C4 (4712388)
  Default gas price:                      20000000000

  Tests currently fail at maximum of 11 investors
*/
contract('Advanced', (accounts) => {
  const MANAGER = accounts[0]
  const EXCHANGE = accounts[1]
  const GAS_AMT = 500000;
  const MGMT_FEE_BPS = 100;
  const SECONDS_IN_YEAR = 31536000;
  const PERFORM_FEE_BPS = 2000;

  const investors = accounts.slice(2);
  let fund, navCalculator, valueFeed, investorActions;
  const getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber();
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToWei = eth => web3.toWei(eth, 'ether');

  before((done) => {
    Promise.all([Fund.deployed(), NavCalculator.deployed(), InvestorActions.deployed()])
    .then(values => {
      [fund, navCalculator, investorActions] = values;
      navCalculator.setFund(fund.address);
      investorActions.setFund(fund.address);
    }).then(() => {
      return Promise.all(investors.map(acct => fund.modifyAllocation(acct, ethToWei(30))));
    }).then(() => { done(); })
    .catch(console.error);
  });

  beforeEach((done) => {
    console.log('**** Resetting subscription ****');
    Promise.all(investors.map(acct => fund.requestSubscription({ from: acct, value: ethToWei(5)})))
    .then(() => {
      // Gas for subscribing a single investor ~=81800
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, i) => {
        assert(weiToNum(val[1]) !== 0, 'Subscription Request failed');
      });
      return fund.fillAllSubscriptionRequests();
    }).then(() => {
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, i) => {
        assert.equal(weiToNum(val[1]), 0, 'Subscription failed: incorrect ethPendingSubscription');
        assert(weiToNum(val[2]) !== 0, 'Subscription failed: incorrect balance');
      });
    }).then(() => { done();})
    .catch(console.error);
  });

  // Gas for redeeming a single investor ~=399000
  it('should redeem all redemption requests', (done) => {
    fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(99), gas: GAS_AMT })
    .then(() => {
      return Promise.all(investors.map(acct => fund.requestRedemption(ethToWei(5), { from: acct })));
    }).then(() => fund.fillAllRedemptionRequests())
    .then(() => {
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[3]), 0, `redemption index: ${index}, addr: ${val} failed to process`);
        assert(weiToNum(val[4]) > 0, 'Redemption failed due to sendToExchange');
      });
    }).then(() => { done(); })
    .catch(done);
  });

  // Gas for liquidating a single investor ~=414700
  it('should liquidate all investors', (done) => {
    fund.liquidateAllInvestors()
    .then(() => {
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[2]), 0, `liquidation index: ${index}, addr: ${val} failed to process`);
        assert(weiToNum(val[4]) > 0, 'Liquidation failed due to sendToExchange');
      });
    }).then(() => { done(); })
    .catch(done);
  });

  // Test when fund balance lowers during redeemAll
  // (currently failing because sendToExchange is not disabled during redeemAll)
  xit('should not let exchange balance change affect redeemAll', (done) => {
    Promise.all(investors.map(acct => fund.requestRedemption(ethToWei(5), { from: acct })))
    .then(() => {
      fund.fillAllRedemptionRequests();
      return fund.sendToExchange(ethToWei(80));
    }).then(() => {
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[3]), 0, 'Redemption failed due to sendToExchange');
        assert(weiToNum(val[4]) > 0, 'Redemption failed due to sendToExchange');
      });
    }).then(() => { done(); })
    .catch(done);
  });

  // Test when fund balance lowers during liquidateAll
  // (currently failing because sendToExchange is not disabled during liquidateAll)
  xit('should not let exchange balance change affect liquidateAll', (done) => {
    fund.liquidateAllInvestors();
    fund.sendToExchange(ethToWei(60))
    .then(() => {
      return Promise.all(investors.map(acct => fund.getInvestor(acct)));
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[2]), 0, 'Liquidation failed due to sendToExchange');
        assert(weiToNum(val[4]) > 0, 'Liquidation failed due to sendToExchange');
      });
    }).then(() => { done(); })
    .catch(done);
  });

});
