const path = require('path');
const Promise = require('bluebird');

const DataFeed = artifacts.require('./DataFeed.sol');
const NewNavCalculator = artifacts.require('./NewNavCalculator.sol');
const FundLogic = artifacts.require('./FundLogic.sol');

const Fund = artifacts.require('./Fund.sol');

const { constructors } = require('../migrations/artifacts');

const { increaseTime, sendTransaction, arrayToObject } = require('../js/helpers');

const scriptName = path.basename(__filename);

const keys = ['date2', 'navPerShare', 'lossCarryforward', 'accumulatedMgmtFees', 'accumulatedAdminFees'];

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

const {
  ethToWei, getInvestorData, getShareClassData, getContractNumericalData, getBalancePromise,
} = require('../utils');

// DEPLOY PARAMETERS
const {
  USD_ETH_EXCHANGE_RATE,
  USD_BTC_EXCHANGE_RATE,
  USD_LTC_EXCHANGE_RATE,
  MIN_INITIAL_SUBSCRIPTION_ETH,
  MIN_SUBSCRIPTION_ETH,
  MIN_INITIAL_SUBSCRIPTION_USD,
  MIN_SUBSCRIPTION_USD,
  ADMIN_FEE,
  MGMT_FEE,
  PERFORM_FEE,
} = require('../config');

contract('New NavCalculator', (accounts) => {
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const investors = accounts.slice(2);

  const ADMIN_FEE_BPS = ADMIN_FEE * 100;
  const MGMT_FEE_BPS = MGMT_FEE * 100;
  const SECONDS_IN_YEAR = 31536000;
  const PERFORM_FEE_BPS = PERFORM_FEE * 100;
  const TIMEDIFF = 60 * 60 * 24 * 30;

  // Deployed contract instances
  let dataFeed;
  let navCalculator;
  let fundLogic;

  let oldFund;

  // New contract instances
  let fundStorage;
  let fund;

  let totalSupply;
  let totalEthPendingSubscription;
  let totalEthPendingWithdrawal;
  let navPerShare;
  let accumulatedMgmtFees;
  let accumulatedAdminFees;
  let accumulatedPerfFees;
  let lossCarryforward;
  let usdEth;

  // Helpers
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToUsd = eth => (eth * usdEth) / 1e20;
  const usdToEth = usd => (usd * 1e20) / usdEth;

  const changeExchangeValue = _multiplier => new Promise((resolve, reject) => {
    resolve(dataFeed.updateWithExchange(_multiplier));
    // .then(() => dataFeed.value())
    // .then((_val) => console.log("new portfolio value (USD):", parseInt(_val)))
    // );
  });

  const retrieveFundParams = () => Promise.all([
    fund.lastCalcDate.call(),
    fund.navPerShare.call(),
    fund.lossCarryforward.call(),
    fund.accumulatedMgmtFees.call(),
    fund.accumulatedAdminFees.call(),
  ]);

  const checkRoughEqual = (vals, _navPerShare, _lossCarryforward, _accumulatedMgmtFees, _accumulatedAdminFees) => {
    const [ansNAV, ansLCF, ansAMF, ansAAF] = vals;

    assert(Math.abs((Number(_navPerShare) / ansNAV) - 1) < 0.0001, 'incorrect navPerShare');

    if (ansLCF !== 0) assert(Math.abs((Number(_lossCarryforward) / ansLCF) - 1) < 0.0001, 'incorrect lossCarryforward');
    else assert.equal(Number(lossCarryforward), 0, 'incorrect lossCarryforward');

    if (ansAMF !== 0) assert((Math.abs(Number(_accumulatedMgmtFees) / ansAMF) - 1) < 0.0001, 'incorrect accumulatedMgmtFees');
    else assert.equal(Number(_accumulatedMgmtFees), 0, 'incorrect accumulatedMgmtFees');

    if (ansAAF !== 0) assert(Math.abs((Number(_accumulatedAdminFees) / ansAAF) - 1) < 0.0001, 'incorrect accumulatedAdminFees');
    else assert.equal(Number(_accumulatedAdminFees), 0, 'incorrect accumulatedAdminFees');
  };

  const calc = elapsedTime => new Promise((resolve, reject) => {
    let fundBal;
    let portfolioValueUsd;
    let ts;
    Promise.all([dataFeed.value(), fund.getBalance(), fund.totalSupply()])
      .then((_vals) => {
        [portfolioValueUsd, fundBal, ts] = _vals;
        const gav = Number(portfolioValueUsd) + ethToUsd(Number(fundBal));
        // console.log('gav', gav);
        let nav = (ts * navPerShare) / 10000;
        // console.log('nav', nav);
        const mgmtFee = Math.trunc(navPerShare * (MGMT_FEE_BPS / 10000) * (elapsedTime / SECONDS_IN_YEAR) * (ts / 10000));
        const adminFee = Math.trunc(navPerShare * (ADMIN_FEE_BPS / 10000) * (elapsedTime / SECONDS_IN_YEAR) * (ts / 10000));
        // console.log('mgmtFee', mgmtFee);
        const gpvLessFees = gav - accumulatedMgmtFees - accumulatedAdminFees;
        // console.log('gpvlessFees', gpvlessFees);
        const gainLoss = gpvLessFees - nav - mgmtFee - adminFee;

        // If there are any accumulated performance fees and if there is a loss in calculation period
        // return the performance fees first
        const performFeePayback = (accumulatedPerfFees > 0 && gainLoss < 0) ? Math.min(accumulatedPerfFees, -gainLoss) : 0;

        const lossPayback = gainLoss > 0 ? Math.min(gainLoss, lossCarryforward) : 0;
        const gainLossAfterPayback = gainLoss - lossPayback;
        const performFee = gainLossAfterPayback > 0 ? Math.trunc(gainLossAfterPayback * (PERFORM_FEE_BPS / 10000)) : 0;
        // console.log('performFee', performFee);
        const netGainLossAfterPerformFee = (gainLossAfterPayback + lossPayback) - performFee;
        // console.log('netGainLossAfterPerformFee', netGainLossAfterPerformFee);
        nav += netGainLossAfterPerformFee + performFeePayback;
        if (netGainLossAfterPerformFee < 0) lossCarryforward += Math.abs(netGainLossAfterPerformFee);

        navPerShare = Math.trunc((nav * 10000) / totalSupply);

        lossCarryforward -= lossPayback + (performFeePayback / (PERFORM_FEE_BPS / 10000));
        accumulatedMgmtFees += (mgmtFee + performFee) - performFeePayback;
        accumulatedAdminFees += adminFee;
        accumulatedPerfFees += performFee - performFeePayback;
        resolve([navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedAdminFees]);
      })
      .catch(reject);
  });

  before(() => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return DataFeed.deployed()
      .then(_instance => dataFeed = _instance)
      .then(() => constructors.FundStorage(MANAGER, EXCHANGE))
      .then(_instance => fundStorage = _instance)
      .then(() => constructors.FundLogic(MANAGER, dataFeed, fundStorage))
      .then(_instance => fundLogic = _instance)

      .then(() => constructors.NewNavCalculator(MANAGER, dataFeed, fundStorage, fundLogic))
      .then(_instance => navCalculator = _instance)

      .then(() => constructors.NewFund(MANAGER, dataFeed, fundStorage, fundLogic, navCalculator))
      .then(_instance => fund = _instance)
      .then(() => Promise.all([
        fundStorage.setFund(fund.address),
        fundLogic.setFund(fund.address),
        navCalculator.setFund(fund.address),
        navCalculator.setFundStorage(fundStorage.address),
      ]))
      .then(() => Promise.all([
        fundStorage.fundAddress(),
        fundLogic.fundAddress(),
        navCalculator.fundAddress(),
      ]))
      .then(_addresses => _addresses.map(_address => assert.strictEqual(_address, fund.address, 'fund address not set')))

      .then(() => console.log(`  => FundStorage       | ${fundStorage.address}`))
      .then(() => console.log(`  => FundLogic         | ${fundLogic.address}`))
      .then(() => console.log(`  => NewFund           | ${fund.address}\n`))

      .then(() => Promise.all(investors.slice(5).map(_investor => web3.eth.getBalancePromise(_investor))))
      .then((_balances) => {
        const sendBalancePromises = [];
        _balances.forEach((_bal, index) => {
          if (web3.fromWei(_bal, 'ether') > 1) {
            sendBalancePromises.push(web3.eth.sendTransactionPromise({
              from: investors.slice(5)[index],
              to: MANAGER,
              value: _bal - web3.toWei(1, 'ether'),
            }));
          }
        });
        return Promise.all(sendBalancePromises);
      })

      .then(() => dataFeed.value())
      .then(_value => console.log(`Data feed value: ${Number(_value)}`))
      // Set dataFeed value to NAV = 100.00
      .then(() => dataFeed.updateByManager(MIN_INITIAL_SUBSCRIPTION_USD * 100, USD_ETH_EXCHANGE_RATE, USD_BTC_EXCHANGE_RATE, USD_LTC_EXCHANGE_RATE))
      .then(() => dataFeed.value())
      .then(_value => console.log(`Data feed value: ${Number(_value)}`))

      // set Share Class 0 to zero fees
      .then(() => fundStorage.modifyShareClassTerms(0, 0, 0, 0))
      .then(() => getShareClassData(fundStorage, 0))
      .then(_shareClassDetails => console.log(_shareClassDetails))

      // subscribe an investor
      .catch(err => assert.throw(`Before subscribe investor ${err.toString()}`))
      .then(() => fund.whiteListInvestor(investors[0], 2, 0), { from: MANAGER })
      .then(() => fund.subscribeUsdInvestor(investors[0], MIN_INITIAL_SUBSCRIPTION_USD * 100, { from: MANAGER }))
      .catch(err => assert.throw(`After subscribe investor ${err.toString()}`));
  });

  describe('Initialize NAV values and details', () => {
    it('should run calcShareClassNav', () => navCalculator.calcShareClassNav(0, { from: fund.address })
      .then((_values) => {
        assert.isAbove(_values[0], 0, 'lastCalc is 0');
        assert.strictEqual(_values[1], 10000, 'nav is not 100.00%');
        _values.slice(2).map((val, index) => assert.strictEqual(val, 0, `Fee ${index}: is not zero`));
      })
      .then(() => getShareClassData(fundStorage, 0))
      .then(_shareClassDetails => console.log(_shareClassDetails))
      .catch(err => `Error running calcShareClassNav ${err.toString()}`));

    it('should run calcNav', () => fund.calcNav({ from: MANAGER })
      .then(_txObj => console.log(`Tx obj: ${JSON.stringify(_txObj.logs)}`))
      .then(() => getShareClassData(fundStorage, 0))
      .catch(err => assert.throw(`calcNav ${err.toString()}`))
      .then(_shareClassDetails => console.log(_shareClassDetails))
      .catch(err => `Error running calcNav ${err.toString()}`));
  });

  describe('NAV should adjust for different dataFeed values', () => {
    const baseValue = MIN_INITIAL_SUBSCRIPTION_USD * 100;
    const testNav = multiple => it(`DataFeed value: [${multiple}x]`, () =>
      dataFeed.updateByManager(multiple * baseValue, USD_ETH_EXCHANGE_RATE, USD_BTC_EXCHANGE_RATE, USD_LTC_EXCHANGE_RATE)
        .then(() => dataFeed.value())
        .then(_val => assert.equal(Number(_val), Math.trunc(multiple * baseValue), `value @ ${multiple} does not match`))
        .then(() => fund.calcNav())
        .then(() => getShareClassData(fundStorage, 0))
        .then(_shareClassData => assert.strictEqual(_shareClassData.shareNav, Math.trunc(10000 * multiple), 'incorrect Nav'))
        .catch(err => assert.throw(`Error [${multiple}]: ${err.toString()}`)));

    for (let i = 0; i < 5; i += 1) {
      testNav(0.5 + Math.random());
    }
  });

  describe('Calculate NAVs for 2 share classes | 1 with a performance fee', () => {
    const baseValue = 2 * MIN_INITIAL_SUBSCRIPTION_USD * 100;

    before('Subscribe second investor with 20% performance fee', () => fundStorage.addShareClass(0, 0, 2000, { from: MANAGER })
      .then(_txObj => console.log(`\nAdded share class: \n ${JSON.stringify(_txObj.logs)}\n`))

      // subscribe an investor in shareClass[1]
      .then(() => fund.whiteListInvestor(investors[1], 2, 1), { from: MANAGER })
      .then(() => fund.subscribeUsdInvestor(investors[1], MIN_INITIAL_SUBSCRIPTION_USD * 100, { from: MANAGER }))
      .catch(err => assert.throw(`After subscribe investor ${err.toString()}`)));

    const printNav = (_shareClassData) => {
      const details = [`\nPerformanceFees ${_shareClassData.performFeeBps}`];
      ['shareNav', 'accumulatedMgmtFees', 'lossCarryforward'].forEach(field => details.push(`${field} : ${_shareClassData[field]}`));
      return details.join('\n');
    };

    const testNav = multiple => it(`[2] DataFeed value: [${multiple}x]`, () =>
      dataFeed.updateByManager(multiple * baseValue, USD_ETH_EXCHANGE_RATE, USD_BTC_EXCHANGE_RATE, USD_LTC_EXCHANGE_RATE)
        .then(() => dataFeed.value())
        .then(_val => assert.equal(Number(_val), Math.trunc(multiple * baseValue), `value @ ${multiple} does not match`))
        .then(() => fund.calcNav())
        .then(_txObj => console.log(`Tx obj: ${JSON.stringify(_txObj.logs)}`))
        .then(() => getShareClassData(fundStorage, 0))
        .then(_shareClassData => assert.strictEqual(_shareClassData.shareNav, Math.trunc(10000 * multiple), 'incorrect Nav'))

        // shareClass 1: 20% performance fee
        .then(() => Promise.all([getShareClassData(fundStorage, 0), getShareClassData(fundStorage, 1)]))
        .then(_shareClassData => console.log(`\n[${multiple}] \n${printNav(_shareClassData[0])} \n${printNav(_shareClassData[1])}`))
        // .then(_shareClassData => assert.strictEqual(_shareClassData.shareNav, Math.trunc(10000 * multiple), 'incorrect Nav'))
        .catch(err => assert.throw(`Error [${multiple}]: ${err.toString()}`)));

    [1, 1.25, 1.5, 1.25, 1, 0.5, 0.75, 1].map(x => testNav(x));
  });

  describe('Calculate NAVs for 2 share classes after subscription at NAV > 100', () => {
    const initialBaseValue = 2 * MIN_INITIAL_SUBSCRIPTION_USD * 100;
    const baseValue = 4 * MIN_INITIAL_SUBSCRIPTION_USD * 100;
    const newNAV = 120;

    const printNav = (_shareClassData) => {
      const details = [`\nPerformanceFees ${_shareClassData.performFeeBps}`];
      ['shareSupply', 'shareNav', 'accumulatedMgmtFees', 'lossCarryforward'].forEach(field => details.push(`${field} : ${_shareClassData[field]}`));
      return details.join('\n');
    };

    before('Subscribe third investor with 20% performance fee', () =>
      dataFeed.updateByManager((newNAV / 100) * initialBaseValue, USD_ETH_EXCHANGE_RATE, USD_BTC_EXCHANGE_RATE, USD_LTC_EXCHANGE_RATE)

        .then(() => dataFeed.value())
        .then(_val => console.log(`Datafeed value: ${Number(_val)}`))
        
        .then(() => fund.calcNav())
        .then(_txObj => console.log(`Tx obj: ${JSON.stringify(_txObj.logs)}`))

        .then(() => Promise.all([getShareClassData(fundStorage, 0), getShareClassData(fundStorage, 1)]))
        .then(_shareClassData => console.log(`\n == BEFORE \n [${newNAV}] \n${printNav(_shareClassData[0])} \n${printNav(_shareClassData[1])}`))

        // subscribe an investor in shareClass[0]
        .then(() => fund.whiteListInvestor(investors[2], 2, 1), { from: MANAGER })
        .then(() => fund.subscribeUsdInvestor(investors[2], MIN_INITIAL_SUBSCRIPTION_USD * 100, { from: MANAGER }))

        // update dataFeed value for new subscription
        .then(() => dataFeed.updateByManager(
          ((newNAV / 100) * initialBaseValue) + (MIN_INITIAL_SUBSCRIPTION_USD * 100),
          USD_ETH_EXCHANGE_RATE,
          USD_BTC_EXCHANGE_RATE,
          USD_LTC_EXCHANGE_RATE,
        ))

        .then(() => dataFeed.value())
        .then(_val => console.log(`Datafeed value: ${Number(_val)}`))

        .then(() => fund.calcNav())
        .then(_txObj => console.log(`Tx obj: ${JSON.stringify(_txObj.logs)}`))

        .then(() => Promise.all([getShareClassData(fundStorage, 0), getShareClassData(fundStorage, 1)]))
        .then(_shareClassData => console.log(`\n == AFTER SUBSCRIBE \n [${newNAV}] \n${printNav(_shareClassData[0])} \n${printNav(_shareClassData[1])}`))

        .catch(err => assert.throw(`Before ${err.toString()}`)));

    const testNav = multiple => it(`[3] DataFeed value: [${multiple}x]`, () =>
      dataFeed.updateByManager(multiple * baseValue, USD_ETH_EXCHANGE_RATE, USD_BTC_EXCHANGE_RATE, USD_LTC_EXCHANGE_RATE)
        .then(() => dataFeed.value())
        .then(_val => assert.equal(Number(_val), Math.trunc(multiple * baseValue), `value @ ${multiple} does not match`))
        .then(() => fund.calcNav())
        .then(_txObj => console.log(`Tx obj: ${JSON.stringify(_txObj.logs)}`))
        .then(() => getShareClassData(fundStorage, 0))
        .then(_shareClassData => assert.strictEqual(_shareClassData.shareNav, Math.trunc(10000 * multiple), 'incorrect Nav'))

        // shareClass 1: 20% performance fee
        .then(() => Promise.all([getShareClassData(fundStorage, 0), getShareClassData(fundStorage, 1)]))
        .then(_shareClassData => console.log(`\n[${multiple}] \n${printNav(_shareClassData[0])} \n${printNav(_shareClassData[1])}`))
        // .then(_shareClassData => assert.strictEqual(_shareClassData.shareNav, Math.trunc(10000 * multiple), 'incorrect Nav'))
        .catch(err => assert.throw(`Error [${multiple}]: ${err.toString()}`)));

    [1].map(x => testNav(x));
  });
});
