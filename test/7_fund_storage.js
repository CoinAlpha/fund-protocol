const path = require('path');
const Promise = require('bluebird');

const FundStorage = artifacts.require('./FundStorage.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

const { ethToWei } = require('../utils');

// DEPLOY PARAMETERS
const {
  USD_ETH_EXCHANGE_RATE,
  MIN_INITIAL_SUBSCRIPTION_USD,
} = require('../config');


contract('FundStorage', (accounts) => {
  accounts.pop(); // Remove Oraclize account
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const FUND = accounts[2];
  const FUND2 = accounts[3];
  const NOTAUTHORIZED = accounts[4];
  const investors = accounts.slice(5, 11);
  const INVESTOR1 = investors[0];
  const INVESTOR2 = investors[1];
  const INVESTOR3 = investors[2];
  const INVESTOR4 = investors[3];
  const INVESTOR5 = investors[4];

  const ETH_INVESTOR1 = investors[5];

  let fundStorage;
  let shareClasses;

  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return FundStorage.deployed()
      .then(_fundStorage => fundStorage = _fundStorage)
      .then(() => fundStorage.setFund(FUND, { from: MANAGER }))
      .then(() => fundStorage.getInvestorAddresses.call({ from: MANAGER }))
      .then(_investorAddresses => assert.strictEqual(_investorAddresses.length, 0, 'investor list is not empty'))
      .then(() => fundStorage.numberOfShareClasses.call({ from: MANAGER }))
      .then(_numberOfShareClasses => assert.strictEqual(Number(_numberOfShareClasses), 1, 'number of share classes is not 1'))
      .catch(err => assert.throw(`failed to initialize fundStorage: ${err.toString()}`));
  });

  describe('Check if there are any investors', () => {
    it('should have a hasInvestor function', () => assert.isDefined(fundStorage.getInvestorType, 'function undefined'));

    investors.forEach((_investor) => {
      it('should not have the investor', () => fundStorage.getInvestorType.call(_investor)
        .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'should be 0'))
        .catch(assert.throw));
    });
  });

  describe('Add and remove investors', () => {
    const numInvestors = investors.length;
    let split = Math.round(numInvestors / 2);
    const included = investors.slice(split);
    const excluded = investors.slice(0).splice(0, split);

    split = Math.round(included.length / 2);
    const ethInvestors = included.slice(split);
    const usdInvestors = included.slice(0).splice(0, split);

    ethInvestors.forEach((_investor) => {
      it('should add ETH investors', () => fundStorage.setWhiteListInvestor(_investor, 1, 0, { from: FUND })
        .then(() => fundStorage.getInvestorType.call(_investor))
        .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added'))
        .then(() => fundStorage.getInvestor.call(_investor))
        .then(_investorData => assert.strictEqual(Number(_investorData[0]), 1, 'incorrect investor type'))
        .catch(assert.throw));
    });

    usdInvestors.forEach((_investor) => {
      it('should add USD investors', () => fundStorage.setWhiteListInvestor(_investor, 2, 0, { from: FUND })
        .then(() => fundStorage.getInvestorType.call(_investor))
        .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added'))
        .then(() => fundStorage.getInvestor.call(_investor))
        .then(_investorData => assert.strictEqual(Number(_investorData[0]), 2, 'incorrect investor type'))
        .catch(assert.throw));
    });

    excluded.forEach((_investor) => {
      it('should not remove non-existent investors', () => fundStorage.removeInvestor.call(_investor, { from: FUND })
        .then(
          () => assert.throw('removed non-existetnt investor'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0),
        )
        .catch(assert.throw));
    });

    included.sort(() => Math.random() - Math.random());
    included.forEach((_investor) => {
      it('should remove investors', () => fundStorage.removeInvestor(_investor, { from: FUND })
        .then(() => fundStorage.getInvestorType.call(_investor))
        .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'investor was not removed'))
        .catch(assert.throw));
    });
  });  // describe

  describe('getInvestor', () => {
    it('should return an empty investor', () => fundStorage.getInvestor.call(INVESTOR1)
      .then(_vals => _vals.map(_val => assert.strictEqual(Number(_val), 0, 'values are non-zero')))
      .catch(assert.throw));
  }); // describe

  describe('Function Permissions', () => {
    it('add and remove an investor', () => fundStorage.setWhiteListInvestor(INVESTOR1, 1, 0, { from: FUND })
      .then(() => fundStorage.getInvestorType.call(INVESTOR1))
      .catch(err => assert.throw(`Manager could not add an investor ${err.toString()}`))
      .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added by manager'))
      .then(() => fundStorage.getInvestor.call(INVESTOR1))
      .then(_investor => assert.strictEqual(Number(_investor[0]), 1, 'incorrect investor type'))

      .then(() => fundStorage.setWhiteListInvestor(INVESTOR2, 2, 0, { from: FUND }))
      .then(() => fundStorage.getInvestorType.call(INVESTOR2))
      .catch(err => assert.throw(`Manager could not add an investor ${err.toString()}`))
      .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added by manager'))
      .then(() => fundStorage.getInvestor.call(INVESTOR2))
      .then(_investor => assert.strictEqual(Number(_investor[0]), 2, 'incorrect investor type'))

      .then(() => fundStorage.setWhiteListInvestor(INVESTOR3, 2, 0, { from: NOTAUTHORIZED }))
      .then(
        () => assert.throw('should removed investor'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0),
      )
      .then(() => fundStorage.removeInvestor.call(INVESTOR1, { from: NOTAUTHORIZED }))
      .then(
        () => assert.throw('should removed investor'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0),
      )

      .then(() => fundStorage.removeInvestor(INVESTOR1, { from: FUND }))
      .then(() => fundStorage.getInvestorType.call(INVESTOR1))
      .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'investor was not removed'))

      .then(() => fundStorage.removeInvestor(INVESTOR2, { from: MANAGER }))
      .then(() => fundStorage.getInvestorType.call(INVESTOR1))
      .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'investor was not removed'))

      .catch(assert.throw));
  }); // describe

  describe('Share Classes', () => {
    it('initializes ShareClasses with base', () => fundStorage.numberOfShareClasses.call()
      .then(_numberOfShareClasses => assert.strictEqual(Number(_numberOfShareClasses), 1, 'num of share classes is not one'))
      .catch(err => assert.throw(`Error retrieving number of share classes ${err.toString()}`)));

    const shareVariables = ['numberOfShareClasses', 'totalShareSupply'];
    shareVariables.forEach((_var) => {
      it(`init var ${_var}`, () => fundStorage[_var].call()
        .then(_res => assert.strictEqual(Number(_res), 0, `var [${_var}] not initialized to zero`))
        .catch(err => `Error retrieving [${_var}]: ${err.toString()}`));
    });

    const shareClassA = {
      shareClassIndex: 1,
      adminFeeBps: 100,
      mgmtFeeBps: 100,
      performFeeBps: 2000,
      shareSupply: 0,
      shareNav: 100,
    };
    const shareClassB = {
      shareClassIndex: 2,
      adminFeeBps: 100,
      mgmtFeeBps: 50,
      performFeeBps: 1500,
      shareSupply: 0,
      shareNav: 100,
    };
    const shareClassC = {
      shareClassIndex: 3,
      adminFeeBps: 100,
      mgmtFeeBps: 0,
      performFeeBps: 1000,
      shareSupply: 0,
      shareNav: 100,
    };
    shareClasses = [shareClassA, shareClassB, shareClassC];

    describe('add share classes', () => {
      shareClasses.forEach((_shareClass) => {
        it(`should add shareClass ${_shareClass.shareClassIndex}`, () => fundStorage.addShareClass(
          _shareClass.adminFeeBps, _shareClass.mgmtFeeBps, _shareClass.performFeeBps,
          { from: MANAGER },
        )
          .then(txObj => web3.eth.getTransactionReceiptMined(txObj.tx))
          .catch(err => assert.throw(`Error adding share class ${_shareClass.shareClassIndex}: ${err.toString()}`))
          .then(() => fundStorage.getShareClass(_shareClass.shareClassIndex))
          .then((_resShareClass) => {
            assert.strictEqual(Number(_resShareClass[0]), _shareClass.adminFeeBps, 'incorrect admin fee');
            assert.strictEqual(Number(_resShareClass[1]), _shareClass.mgmtFeeBps, 'incorrect mgmt fee');
            assert.strictEqual(Number(_resShareClass[2]), _shareClass.performFeeBps, 'incorrect perform fee');
            assert.strictEqual(Number(_resShareClass[3]), 0, 'incorrect share supply');
            assert.isAbove(Number(_resShareClass[4]), 0, 'incorrect lastCalc');
            assert.strictEqual(Number(_resShareClass[5]), 10000, 'incorrect share Nav');
          }));
      });

      it(`should have the correct number of share classes [${1 + shareClasses.length}]`, () => fundStorage.numberOfShareClasses.call()
        .then(_numberOfShareClasses => assert.strictEqual(
          Number(_numberOfShareClasses),
          1 + shareClasses.length,
          'incorrect number of share classes',
        )));
    });   // describe add share classes

    describe('should modify share classes', () => {
      const modifiedShareClasses = shareClasses.map(_oldShareClass =>
        Object.assign({}, _oldShareClass, {
          adminFeeBps: _oldShareClass.adminFeeBps * 2,
          mgmtFeeBps: _oldShareClass.mgmtFeeBps * 2,
          performFeeBps: _oldShareClass.performFeeBps * 2,
        }));
      modifiedShareClasses.forEach((_modifiedShareClass, index) => {
        it(`should modify shareClass ${_modifiedShareClass.shareClassIndex}`, () =>
          fundStorage.modifyShareClassTerms(
            _modifiedShareClass.shareClassIndex,
            _modifiedShareClass.adminFeeBps,
            _modifiedShareClass.mgmtFeeBps,
            _modifiedShareClass.performFeeBps,
            { from: MANAGER },
          )
            .catch(err => assert.throw(`Error adding share class ${_modifiedShareClass.shareClassIndex}: ${err.toString()}`))
            .then(() => fundStorage.getShareClass(_modifiedShareClass.shareClassIndex))
            .then((_resShareClass) => {
              assert.strictEqual(Number(_resShareClass[0]), shareClasses[index].adminFeeBps * 2, 'incorrect admin fee');
              assert.strictEqual(Number(_resShareClass[1]), shareClasses[index].mgmtFeeBps * 2, 'incorrect mgmt fee');
              assert.strictEqual(Number(_resShareClass[2]), shareClasses[index].performFeeBps * 2, 'incorrect perform fee');
            }));
      });
    });   // describe modify share classes
  });  // describe share classes

  const investorObj1 = {
    investor: INVESTOR1,
    type: 1,
    subscribeAmount: 1000000,
    shareClass: 1,
    shares: 100000,
  };
  const investorObj2 = {
    investor: INVESTOR2,
    type: 2,
    subscribeAmount: 2000000,
    shareClass: 1,
    shares: 200000,
  };
  const investorObj3 = {
    investor: INVESTOR3,
    type: 1,
    subscribeAmount: 3000000,
    shareClass: 2,
    shares: 300000,
  };
  const investorObj4 = {
    investor: INVESTOR4,
    type: 2,
    subscribeAmount: 4000000,
    shareClass: 0,
    shares: 400000,
  };
  const investorsToSubscribe = investors.map(_investor => ({
    investor: _investor,
    type: Math.round(Math.random() * 1) + 1,
    subscribeAmount: Math.round(Math.random() * 10000000),
    shareClass: Math.round(Math.random() * shareClasses.length),
    shares: Math.round(Math.random() * 10000000),
  }));

  describe('Subscribe investor', () => {
    let totalSupply;
    let selectedShareClass;
    let shareClassCount;

    investorsToSubscribe.forEach((_investor, index) => {
      console.log(_investor);
      it(`should white list investor ${index}`, () => fundStorage.setWhiteListInvestor(
        _investor.investor,
        _investor.type,
        _investor.shareClass,
        { from: FUND },
      )
        .catch(err => assert.throw(`Error adding investor: ${err.toString()}`))

        // request subscription
        .then(() => fundStorage.modifyInvestor(
          _investor.investor,
          _investor.type,
          _investor.subscribeAmount,
          0,
          _investor.shareClass,
          0,
          0,
          'request subscription',
          { from: FUND },
        ))
        .catch(err => assert.throw(`Error modifying investor: ${err.toString()}`))
        .then(() => fundStorage.getInvestor(_investor.investor))
        .then((_investorStruct) => {
          const investorStruct = _investorStruct.map(x => Number(x));
          const fields = ['type', 'subscribeAmount', undefined, 'shareClass', undefined];
          investorStruct.forEach((_val, i) => {
            const targetVal = fields[i] ? _investor[fields[i]] : 0;
            assert.strictEqual(_val, targetVal, `${fields[i]} does not match`);
          });
        }));  // it

      it(`should allocate investor ${index}`, () => fundStorage.modifyInvestor(
        _investor.investor,
        _investor.type,
        0,
        _investor.shares,
        _investor.shareClass,
        0,
        0,
        'request subscription',
        { from: FUND },
      )
        .then(txObj => web3.eth.getTransactionReceiptMined(txObj.tx))
        .catch(err => assert.throw(`Error modifying investor: ${err.toString()}`))
        .then(() => fundStorage.getInvestor(_investor.investor))
        .then((_investorStruct) => {
          const investorStruct = _investorStruct.map(x => Number(x));
          const fields = ['type', undefined, 'shares', 'shareClass', undefined];
          investorStruct.forEach((_val, i) => {
            const targetVal = fields[i] ? _investor[fields[i]] : 0;
            assert.strictEqual(_val, targetVal, `${fields[i]} does not match`);
          });
        }));  // it

      it(`should modify share count ${index}`, () =>
        Promise.all([fundStorage.totalShareSupply.call(), fundStorage.getShareClass.call(_investor.shareClass)])
          .then((_vals) => {
            totalSupply = Number(_vals[0]);
            selectedShareClass = _vals[1].map(x => Number(x));
            shareClassCount = selectedShareClass[3];
          })
          .then(() => fundStorage.modifyShareCount(
            _investor.shareClass, shareClassCount + _investor.shares,
            totalSupply + _investor.shares,
            { from: FUND },
          ))
          .catch(err => assert.throw(`Error modifying share count: ${err.toString()}`))
          .then(() => Promise.all([fundStorage.totalShareSupply.call(), fundStorage.getShareClass.call(_investor.shareClass)]))
          .then((_vals) => {
            assert.strictEqual(Number(_vals[0]), totalSupply + _investor.shares, 'incorrect number of total shares');
            assert.strictEqual(Number(_vals[1][3]), shareClassCount + _investor.shares, 'incorrect number of share class shares');
          }));  // it
    }); // forEach
  }); // describe subscribe investor

  describe('Subscribe ETH investor', () => {
    let totalSupply;
    let selectedShareClass;
    let shareClassCount;

    const amount = ethToWei(MIN_INITIAL_SUBSCRIPTION_USD / USD_ETH_EXCHANGE_RATE);

    it('should have an setEthPendingSubscription function', () => assert.isDefined(fundStorage.setEthPendingSubscription, 'function undefined'));

    console.log(ETH_INVESTOR1);
    it(`should white list investor ${ETH_INVESTOR1}`, () => fundStorage.setWhiteListInvestor(ETH_INVESTOR1, 1, 0, { from: FUND })
      .catch(err => assert.throw(`Error adding investor: ${err.toString()}`))

      .then(() => fundStorage.fundAddress.call())
      .then(_fundAddress => assert.strictEqual(_fundAddress, FUND))
      .catch(err => `Error retrieving fundAddress ${err.toString()}`)

      // request subscription
      .then(() => fundStorage.setEthPendingSubscription(ETH_INVESTOR1, Number(amount), { from: FUND }))
      .catch(err => assert.throw(`Error setEthPendingSubscription: ${err.toString()}`))
      .then(() => fundStorage.getInvestor(ETH_INVESTOR1))
      .then(_investorStruct => assert.strictEqual(
        Number(_investorStruct[1]),
        Number(amount),
        'ethPendingSubscription does not match',
      )));  // it
  }); // describe subscribe ETH investor

  describe('getNavPerShare', () => {
    const testNav = _shareClass => fundStorage.getShareClassNavPerShare(_shareClass)
      .then(_nav => assert.strictEqual(Number(_nav), 10000, 'NAV is not equal to 10000'))
      .catch(err => `Error getting NavPerShare: ${err.toString()}`);

    for (let i = 0; i <= shareClasses.length; i += 1) {
      it(`should get the shareClass ${i} NAV`, () => testNav(i));
    }
  }); // describe getNavPerShare
}); // contract
