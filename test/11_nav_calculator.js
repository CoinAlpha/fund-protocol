const path = require('path');
const Promise = require('bluebird');

const DataFeed = artifacts.require('./DataFeed.sol');
const NewNavCalculator = artifacts.require('./NewNavCalculator.sol');
const FundLogic = artifacts.require('./FundLogic.sol');

const { constructors } = require('../migrations/artifacts');

const { increaseTime, sendTransaction, arrayToObject } = require('../js/helpers');

const scriptName = path.basename(__filename);

const keys = ['date2', 'navPerShare', 'lossCarryforward', 'accumulatedMgmtFees', 'accumulatedAdminFees'];

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

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
  const getBalancePromise = address => web3.eth.getBalancePromise(address);
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
    return Promise.all([DataFeed.deployed(), NewNavCalculator.deployed(), FundLogic.deployed()])
      .then(_instances => [dataFeed, navCalculator, fundLogic] = _instances)
      .then(() => constructors.FundStorage(MANAGER, EXCHANGE))
      .then(_instance => fundStorage = _instance)
      .then(() => constructors.FundLogic(MANAGER, dataFeed, fundStorage))
      .then(_instance => fundLogic = _instance)
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

      .then(() => console.log('======================='))
      .then(() => console.log(Object.keys(fundStorage)))
      .then(() => console.log('======================='))
      .then(() => console.log(Object.keys(fund)))

      .then(() => fundStorage.numberOfShareClasses())
      .then(_data => console.log(`share classes: ${Number(_data)}`))

      // set Share Class 0 to zero fees
      .then(() => fundStorage.modifyShareClassTerms(0, 0, 0, 0))
      .then(() => fundStorage.getShareClassDetails(0))
      .then(_shareClassDetails => _shareClassDetails.map(x => console.log(Number(x), 0, 'fees not set to zero')))
      // .then(_shareClassDetails => _shareClassDetails.map(x => assert.strictEqual(Number(x), 0, 'fees not set to zero')))
      .then(() => fundStorage.getShareClassNavDetails(0))
      .then(_shareClassDetails => _shareClassDetails.map(x => console.log(Number(x), 0, 'fees not set to zero')))

      .then(() => fundStorage.getInvestorAddresses())
      .then(_addresses => console.log(`Addresses: ${_addresses}`))

      // subscribe an investor
      .catch(err => assert.throw(`Before subscribe investor ${err.toString()}`))
      .then(() => fund.whiteListInvestor(investors[0], 2, 0), { from: MANAGER })
      .then(() => fund.subscribeUsdInvestor(investors[0], MIN_INITIAL_SUBSCRIPTION_USD * 100, { from: MANAGER }))
      .then(() => fundStorage.getInvestor(investors[0]))
      .then(_data => console.log(`Investor: ${_data.map(x => Number(x))}`))
      .catch(err => assert.throw(`Failed to whiteList investor ${err.toString()}`))
      .then(() => fundStorage.getInvestorAddresses())
      .catch(err => assert.throw(`Failed to subscribe investor ${err.toString()}`))
      .then(_addresses => console.log(`Addresses: ${_addresses}`))
      .catch(err => assert.throw(err.toString()));
  });

  it('should run calcShareClassNav', () => navCalculator.calcShareClassNav(0, { from: fund.address })
    .then(() => fundStorage.getShareClassDetails(0))
    .catch(err => assert.throw(`calcShareClassNav ${err.toString()}`))
    .then(_shareClassDetails => _shareClassDetails.map(x => console.log(Number(x))))
    .then(() => fund.calcNav({ from: MANAGER }))
    .then(() => fundStorage.getShareClassNavDetails(0))
    .then(_shareClassDetails => _shareClassDetails.map(x => console.log(Number(x), 0, 'fees not set to zero')))
  );

  it('should set value feed to the correct data feed address', (done) => {
    navCalculator.setDataFeed(dataFeed.address)
      .then(() => navCalculator.dataFeed.call())
      .then((_address) => {
        assert.equal(_address, dataFeed.address, 'data feed addresses don\'t match');
        done();
      });
  });
});
