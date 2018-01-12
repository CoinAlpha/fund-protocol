const path = require('path');
const Promise = require('bluebird');

const NewFund = artifacts.require('./NewFund.sol');
const FundStorage = artifacts.require('./FundStorage.sol');
const DataFeed = artifacts.require('./DataFeed.sol');
const NewInvestorActions = artifacts.require('./NewInvestorActions.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

const {
  ethToWei, getInvestorData, getContractNumericalData, getBalancePromise,
} = require('../utils');

// DEPLOY PARAMETERS
const {
  USD_ETH_EXCHANGE_RATE,
  MIN_INITIAL_SUBSCRIPTION_USD,
  MIN_SUBSCRIPTION_USD,
  MIN_REDEMPTION_SHARES,
  ADMIN_FEE,
  MGMT_FEE,
  PERFORM_FEE,
} = require('../config');

contract('New Fund', (accounts) => {
  accounts.pop(); // Remove Oraclize account
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const FUND = accounts[2];
  const FUND2 = accounts[3];
  const NOTAUTHORIZED = accounts[4];
  const investors = accounts.slice(5);
  const INVESTOR1 = investors[0];
  const INVESTOR2 = investors[1];
  const INVESTOR3 = investors[2];
  const INVESTOR4 = investors[3];

  const ethInvestors = investors.slice(5, 10);
  const usdInvestors = investors.slice(11, 16);

  const ETH_INVESTOR1 = ethInvestors[0];
  const ETH_INVESTOR2 = ethInvestors[1];
  const USD_INVESTOR1 = usdInvestors[0];
  const USD_INVESTOR2 = usdInvestors[1];

  const MIN_INITIAL_CENTS = MIN_INITIAL_SUBSCRIPTION_USD * 100;
  const MIN_INITIAL_SHARES = MIN_INITIAL_CENTS;
  const MIN_SUB_CENTS = MIN_SUBSCRIPTION_USD * 100;
  const MIN_SUB_SHARES = MIN_SUB_CENTS;

  const WEI_MIN_INITIAL = ethToWei((MIN_INITIAL_SUBSCRIPTION_USD) / USD_ETH_EXCHANGE_RATE);
  const WEI_BELOW_MIN_INITIAL = ethToWei((MIN_INITIAL_SUBSCRIPTION_USD - 1) / USD_ETH_EXCHANGE_RATE);
  const WEI_MIN_SUB = ethToWei((MIN_SUBSCRIPTION_USD) / USD_ETH_EXCHANGE_RATE);
  const WEI_BELOW_MIN_SUB = ethToWei((MIN_SUBSCRIPTION_USD - 1) / USD_ETH_EXCHANGE_RATE);

  // Contract instances
  let newFund;
  let fundStorage;
  let dataFeed;
  let investorActions;

  // Temp variables
  let fundBalance;
  let totalEthPendingSubscription;

  const fundStorageFields = [
    'decimals',
    'minInitialSubscriptionUsd',
    'minSubscriptionUsd',
    'minRedemptionShares',
  ];

  const dataFeedFields = [
    'value',
    'usdEth',
    'usdBtc',
    'usdLtc',
    'timestamp',
  ];

  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([
      NewFund.deployed(),
      FundStorage.deployed(),
      DataFeed.deployed(),
      NewInvestorActions.deployed(),
    ])
      .then(_instances => [newFund, fundStorage, dataFeed, investorActions] = _instances)
      .catch(err => assert.throw(`failed to get instances: ${err.toString()}`))
      .then(() => fundStorage.setFund(newFund.address, { from: MANAGER }))
      .catch(err => assert.throw(`failed - fundStorage.setFund(): ${err.toString()}`))
      .then(() => investorActions.setFund(newFund.address, { from: MANAGER }))
      .catch(err => assert.throw(`failed - investorActions.setFund(): ${err.toString()}`))
      .then(() => fundStorage.getInvestorType(INVESTOR1))
      .then(contains => assert.strictEqual(Number(contains), 0, 'investor already whitelisted'))
      .catch(err => assert.throw(`failed getInvestorType: ${err.toString()}`))
      .then(() => Promise.all([
        newFund.manager.call(),
        newFund.exchange.call(),
        newFund.navCalculator.call(),
        newFund.investorActions.call(),
        newFund.fundStorage.call(),
      ]))
      .then(_addresses => _addresses.forEach(_address => assert.notEqual(_address, '0x0000000000000000000000000000000000000000', 'Contract address not set')))
      .catch(err => `  Error retrieving variables: ${err.toString()}`)
      .then(() => {
        getContractNumericalData('FundStorage Fields Data', fundStorage, fundStorageFields);
        getContractNumericalData('DataFeed Fields Data', dataFeed, dataFeedFields);
      })
      .catch(err => assert.throw(`failed to get contracts data: ${err.toString()}`));
  });

  describe('getFundDetails()', () => {
    let newFundDetails;
    let fundStorageDetails;

    it('can get fund details', () => newFund.getFundDetails()
      .then(_details => newFundDetails = _details)
      .catch(err => `Error calling newFund getFundDetails(): ${err.toString()}`)
      .then(() => Promise.all([
        fundStorage.name(),
        fundStorage.symbol(),
        fundStorage.minInitialSubscriptionUsd(),
        fundStorage.minSubscriptionUsd(),
        fundStorage.minRedemptionShares(),
      ]))
      .then(_details => fundStorageDetails = _details)
      .then(() => newFundDetails.forEach((_detail, index) => {
        if (typeof _detail === 'string') {
          assert.strictEqual(_detail, fundStorageDetails[index], 'string details do not match');
        } else {
          assert.strictEqual(Number(_detail), Number(fundStorageDetails[index]), 'number details do not match');
        }
      })));
  });  // describe

  describe('whiteListInvestor', () => {
    it('should have a whiteListInvestor function', () => assert.isDefined(newFund.whiteListInvestor, 'function undefined'));

    ethInvestors.forEach((_investor, index) => {
      it(`should whitelist an ETH investor [${index}] ${_investor}`, () => getInvestorData(fundStorage, _investor)
        .then(_investorData => assert.strictEqual(_investorData.investorType, 0, 'investor type not initialized'))
        .catch(err => assert.throw(`Error getting investor 1: ${err.toString()}`))
        .then(() => newFund.whiteListInvestor(_investor, 1, 0, { from: MANAGER }))
        .catch(err => assert.throw(`Error whitelisting investor ${_investor}: ${err.toString()}`))
        .then(() => getInvestorData(fundStorage, _investor))
        .then(_investorData => assert.strictEqual(_investorData.investorType, 1, 'incorrect investor type'))
        .catch(err => assert.throw(`Error getting investor 2: ${err.toString()}`)));
    });

    usdInvestors.forEach((_investor, index) => {
      it(`should whitelist an USD investor [${index}] ${_investor}`, () => getInvestorData(fundStorage, _investor)
        .then(_investorData => assert.strictEqual(_investorData.investorType, 0, 'investor type not initialized'))
        .catch(err => assert.throw(`Error getting investor 1: ${err.toString()}`))
        .then(() => newFund.whiteListInvestor(_investor, 2, 0, { from: MANAGER }))
        .catch(err => assert.throw(`Error whitelisting investor ${_investor}: ${err.toString()}`))
        .then(() => getInvestorData(fundStorage, _investor))
        .then(_investorData => assert.strictEqual(_investorData.investorType, 2, 'incorrect investor type'))
        .catch(err => assert.throw(`Error getting investor 2: ${err.toString()}`)));
    });
  }); // describe

  describe('requestEthSubscription - New Investor', () => {
    it('not allow ETH subscription request below minimumInitialSubscriptionUsd', () => getInvestorData(fundStorage, ETH_INVESTOR1)
      .then(_investorData => assert.strictEqual(Number(_investorData.investorType), 1, 'incorrect investor type'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: ETH_INVESTOR1, value: WEI_BELOW_MIN_INITIAL }))
      .then(
      () => assert.throw('should not have reached here'),
      e => assert.isAtLeast(e.message.indexOf('revert'), 0)
      )
    ); // it

    it('accept valid requestEthSubscription request', () => getBalancePromise(newFund.address)
      .then(_bal => fundBalance = Number(_bal))
      .then(() => newFund.totalEthPendingSubscription())
      .then(_amount => assert.strictEqual(Number(_amount), 0, 'totalEthPendingSubscription is not 0'))
      .catch(err => assert.throw(`Error retrieving totalEthPendingSubscription ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: ETH_INVESTOR1, value: WEI_MIN_INITIAL }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error requesting Eth subscription: ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.ethPendingSubscription), Number(WEI_MIN_INITIAL), 'incorrect ethPendingSubscription amount'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => getBalancePromise(newFund.address))
      .then(_bal => assert.strictEqual(Number(_bal), fundBalance + Number(WEI_MIN_INITIAL), 'incorrect fund balance increase'))
      .then(() => newFund.totalEthPendingSubscription())
      .then(_amount => assert.strictEqual(Number(_amount), Number(WEI_MIN_INITIAL), 'totalEthPendingSubscription is incorrect'))
    );

    it('not allow USD investor to request ETH subscription', () => getInvestorData(fundStorage, USD_INVESTOR1)
      .then(_investorData => assert.strictEqual(Number(_investorData.investorType), 2, 'incorrect investor type'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: USD_INVESTOR1, value: WEI_MIN_INITIAL }))
      .then(
      () => assert.throw('should not have reached here'),
      e => assert.isAtLeast(e.message.indexOf('revert'), 0)
      )
    );
  }); // describe requestEthSubscription

  describe('cancelEthSubscription', () => {
    it('not allow cancel ETH subscription for investor with no pending subscription amount', () => getInvestorData(fundStorage, ETH_INVESTOR2)
      .then((_investorData) => {
        assert.strictEqual(Number(_investorData.investorType), 1, 'incorrect investor type');
        assert.strictEqual(Number(_investorData.ethPendingSubscription), 0, 'investor has an outstanding investor amount');
      })
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.cancelEthSubscription({ from: ETH_INVESTOR2 }))
      .then(
      () => assert.throw('should not have reached here'),
      e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error message: ${e.toString()}`)
      )
    ); // it

    let subscriptionBalance;

    it('accept valid cancelEthSubscription request', () => getBalancePromise(newFund.address)
      .then(_bal => fundBalance = Number(_bal))
      .catch(err => assert.throw(`Error getting balance: ${err.toString()}`))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .then((_investorData) => {
        assert.isAbove(Number(_investorData.ethPendingSubscription), 0, 'incorrect ethPendingSubscription amount');
        subscriptionBalance = Number(_investorData.ethPendingSubscription);
      })
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.cancelEthSubscription({ from: ETH_INVESTOR1 }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error requesting cancelEthSubscription: ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.ethPendingSubscription), 0, 'ethPendingSubscription amount is not 0'))
      .then(() => getBalancePromise(newFund.address))
      .then(_bal => assert.strictEqual(Number(_bal), fundBalance - subscriptionBalance, 'incorrect fund balance increase'))
    );

    it('not allow USD investor to request ETH subscription', () => getInvestorData(fundStorage, USD_INVESTOR1)
      .then(_investorData => assert.strictEqual(Number(_investorData.investorType), 2, 'incorrect investor type'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: USD_INVESTOR1, value: WEI_MIN_INITIAL }))
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error message: ${e.toString()}`)
      )
    );
  }); // describe cancelEthSubscription

  describe('subscribeUsdInvestor', () => {
    it('not allow ETH investor to subscribe via subscribeUsdInvestor', () => newFund.subscribeUsdInvestor(ETH_INVESTOR1, MIN_INITIAL_CENTS, { from: MANAGER })
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error: ${e.toString()}`)
      )
    );

    it(`not allow initial USD subscription below MIN_INITIAL_SUBSCRIPTION_USD: ${MIN_INITIAL_CENTS}`, () => newFund.subscribeUsdInvestor(USD_INVESTOR1, MIN_INITIAL_CENTS - 1, { from: MANAGER })
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error: ${e.toString()}`)
      )
    );

    it('should allow investment at minimum amount', () => newFund.subscribeUsdInvestor(USD_INVESTOR1, MIN_INITIAL_CENTS, { from: MANAGER })
      .then(() => getInvestorData(fundStorage, USD_INVESTOR1))
      .catch(err => assert.throw(`Error subscribing USD investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), MIN_INITIAL_SHARES, 'shares amount incorrect'))
    );

    it('should allow investment at > minimum amount', () => newFund.subscribeUsdInvestor(USD_INVESTOR2, MIN_INITIAL_CENTS + 1, { from: MANAGER })
      .then(() => getInvestorData(fundStorage, USD_INVESTOR2))
      .catch(err => assert.throw(`Error subscribing USD investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), MIN_INITIAL_SHARES + 1, 'shares amount incorrect'))
    );

    it(`not allow repeat USD subscription below MIN_SUBSCRIPTION_USD: ${MIN_SUB_CENTS}`, () => newFund.subscribeUsdInvestor(USD_INVESTOR1, MIN_SUB_CENTS - 1, { from: MANAGER })
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error: ${e.toString()}`)
      )
    );

    it('should allow repeat investment at minimum amount', () => newFund.subscribeUsdInvestor(USD_INVESTOR1, MIN_SUB_CENTS, { from: MANAGER })
      .then(() => getInvestorData(fundStorage, USD_INVESTOR1))
      .catch(err => assert.throw(`Error subscribing USD investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), MIN_INITIAL_SHARES + MIN_SUB_SHARES, 'shares amount incorrect'))
    );

    it('should allow repeat investment at > minimum amount', () => newFund.subscribeUsdInvestor(USD_INVESTOR2, MIN_SUB_CENTS + 1, { from: MANAGER })
      .then(() => getInvestorData(fundStorage, USD_INVESTOR2))
      .catch(err => assert.throw(`Error subscribing USD investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), MIN_INITIAL_SHARES + MIN_SUB_SHARES + 2, 'shares amount incorrect'))
    );
  }); // describe subscribeUsdInvestors

  describe('subscribeEthInvestor', () => {
    it('not allow USD investor to subscribe via subscribeEthInvestor', () => newFund.subscribeEthInvestor(USD_INVESTOR1, { from: MANAGER })
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0, `Incorrect error: ${e.toString()}`)
      )
    );

    let EXCHANGE_BALANCE;
    let ETH_BALANCE1;
    
    it('subscribe Eth Investor', () => getInvestorData(fundStorage, ETH_INVESTOR1)
      .then(_investorData => assert.strictEqual(_investorData.ethPendingSubscription, 0, 'there is an existing ethPendingSubscription'))
      .catch(err => assert.throw(`Error retrieving investor data: ${err.toString()}`))

      .then(() => Promise.all([getBalancePromise(newFund.address), getBalancePromise(ETH_INVESTOR1), getBalancePromise(EXCHANGE)]))
      .then((_balances) => {
        [fundBalance, ETH_BALANCE1, EXCHANGE_BALANCE] = _balances.map(x => Number(x));
      })
      .then(() => newFund.totalEthPendingSubscription())
      .then(_amount => assert.strictEqual(Number(_amount), 0, 'totalEthPendingSubscription is not 0'))
      .catch(err => assert.throw(`Error retrieving totalEthPendingSubscription ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: ETH_INVESTOR1, value: WEI_MIN_INITIAL }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error requesting Eth subscription: ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.ethPendingSubscription), Number(WEI_MIN_INITIAL), 'incorrect ethPendingSubscription amount'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => getBalancePromise(newFund.address))
      .then(_bal => assert.strictEqual(Number(_bal), fundBalance + Number(WEI_MIN_INITIAL), 'incorrect fund balance increase'))
      .then(() => newFund.totalEthPendingSubscription())
      .then(_amount => assert.strictEqual(Number(_amount), Number(WEI_MIN_INITIAL), 'totalEthPendingSubscription is incorrect'))

      .then(() => newFund.subscribeEthInvestor(ETH_INVESTOR1, { from: MANAGER }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error subscribing ETH investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), MIN_INITIAL_SHARES, 'shares amount incorrect'))
      .catch(err => assert.throw(`Error retrieving investor data: ${err.toString()}`))

      .then(() => Promise.all([getBalancePromise(newFund.address), getBalancePromise(ETH_INVESTOR1), getBalancePromise(EXCHANGE)]))
      .then((_balances) => {
        const [newFundBalance, NEW_ETH_BALANCE1, NEW_EXCHANGE_BALANCE] = _balances.map(x => Number(x));
        assert.strictEqual(newFundBalance, 0, 'fund balance did not decrease by the correct amount');
        assert.strictEqual(NEW_EXCHANGE_BALANCE - EXCHANGE_BALANCE, Number(WEI_MIN_INITIAL), 'incorrect amount transferred to exchange');
      })
    );

  }); // describe subscribeEthInvestors

  describe('requestEthSubscription - Existing Investor', () => {

    it('investors should have existing shares', () => getInvestorData(fundStorage, ETH_INVESTOR1)
      .then(_investorData => assert.isAbove(Number(_investorData.sharesOwned), 0, 'investor 1 does not have any shares'))
      .catch(err => assert.throw(`Error retrieving investor data: ${err.toString()}`))
    );

    it('not allow ETH subscription request below minimumSubscriptionUsd', () => getInvestorData(fundStorage, ETH_INVESTOR1)
      .then(_investorData => assert.strictEqual(Number(_investorData.investorType), 1, 'incorrect investor type'))
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => newFund.requestEthSubscription({ from: ETH_INVESTOR1, value: WEI_BELOW_MIN_SUB }))
      .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0)
      )
    ); // it

    let ETH_SHARES1;
    
    it('accept valid requestEthSubscription request', () => getBalancePromise(newFund.address)
      .then(_bal => fundBalance = Number(_bal))
      .then(() => newFund.requestEthSubscription({ from: ETH_INVESTOR1, value: WEI_MIN_SUB }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error requesting Eth subscription: ${err.toString()}`))
      .then((_investorData) => {
        assert.strictEqual(Number(_investorData.ethPendingSubscription), Number(WEI_MIN_SUB), 'incorrect ethPendingSubscription amount');
        ETH_SHARES1 = Number(_investorData.sharesOwned);
      })
      .catch(err => assert.throw(`Error getting investor data: ${err.toString()}`))
      .then(() => getBalancePromise(newFund.address))
      .then(_bal => assert.strictEqual(Number(_bal), fundBalance + Number(WEI_MIN_SUB), 'incorrect fund balance increase'))
    );

    let EXCHANGE_BALANCE;
    let ETH_BALANCE1;

    it('subscribe Eth Investor', () => Promise.all([getBalancePromise(newFund.address), getBalancePromise(ETH_INVESTOR1), getBalancePromise(EXCHANGE)])
      .then((_balances) => {
        [fundBalance, ETH_BALANCE1, EXCHANGE_BALANCE] = _balances.map(x => Number(x));
      })
      .then(() => newFund.totalEthPendingSubscription())
      .then(_amount => assert.strictEqual(Number(_amount), Number(WEI_MIN_SUB), 'totalEthPendingSubscription is incorrect'))

      .then(() => newFund.subscribeEthInvestor(ETH_INVESTOR1, { from: MANAGER }))
      .then(() => getInvestorData(fundStorage, ETH_INVESTOR1))
      .catch(err => assert.throw(`Error subscribing ETH investor ${err.toString()}`))
      .then(_investorData => assert.strictEqual(Number(_investorData.sharesOwned), ETH_SHARES1 + MIN_SUB_SHARES, 'shares amount incorrect'))
      .catch(err => assert.throw(`Error retrieving investor data: ${err.toString()}`))

      .then(() => Promise.all([getBalancePromise(newFund.address), getBalancePromise(ETH_INVESTOR1), getBalancePromise(EXCHANGE)]))
      .then((_balances) => {
        const [newFundBalance, NEW_ETH_BALANCE1, NEW_EXCHANGE_BALANCE] = _balances.map(x => Number(x));
        assert.strictEqual(newFundBalance, 0, 'fund balance did not decrease by the correct amount');
        assert.strictEqual(NEW_EXCHANGE_BALANCE - EXCHANGE_BALANCE, Number(WEI_MIN_SUB), 'incorrect amount transferred to exchange');
      })
    );

  }); // describe requestEthSubscription - repeat
  
  xdescribe('redeemUsdInvestor', () => {
    it('not allow redemption below minimum shares', () => {

    });

    it('allow redemption for minimum shares', () => {

    });
  });

  xdescribe('requestEthRedemption', () => {
    it('not allow request below minimum shares', () => {

    });

    it('allow request for minimum shares', () => {

    });
  });

  xdescribe('redeemEthInvestor', () => {
    it('redeem an investor', () => {

    });
  });

  xdescribe('changeModule', () => {
    it('NavCalculator', () => {

    });

    it('InvestorActions', () => {

    });

    it('DataFeed', () => {

    });

    it('FundStroage', () => {

    });
  }); // describe changeModule
}); // contract
