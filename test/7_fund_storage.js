const path = require('path');
const Promise = require('bluebird');

const FundStorage = artifacts.require('./FundStorage.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

contract('FundStorage', (accounts) => {
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const FUND = accounts[2];
  const investors = accounts.slice(3);
  const INVESTOR1 = investors[0];

  let fundStorage;

  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return FundStorage.deployed()
      .then(_fundStorage => fundStorage = _fundStorage)
      .then(() => fundStorage.setFund(FUND, { from: MANAGER }))
      .then(() => fundStorage.getInvestorAddresses.call({ from: MANAGER }))
      .then((_investorAddresses) => assert.strictEqual(_investorAddresses.length, 0, 'investor list is not empty'));
  });

  describe('Check if there are any investors', () => {
    it('should have a hasInvestor function', () => assert.isDefined(fundStorage.getHasInvestor, 'function undefined'));

    investors.forEach((_investor) => {
      it('should not have the investor', () => fundStorage.getHasInvestor.call(_investor)
        .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'should be 0'))
        .catch(assert.throw)
      );
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
      it('should add ETH investors', () => fundStorage.addInvestor(_investor, 1, { from: FUND })
        .then(() => fundStorage.getHasInvestor.call(_investor))
        .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added'))
        .then(() => fundStorage.getInvestor.call(_investor))
        .then(_investor => assert.strictEqual(Number(_investor[0]), 1, 'incorrect investor type'))
        .catch(assert.throw)
      );
    });

    usdInvestors.forEach((_investor) => {
      it('should add USD investors', () => fundStorage.addInvestor(_investor, 2, { from: FUND })
        .then(() => fundStorage.getHasInvestor.call(_investor))
        .then(_hasInvestor => assert.isAbove(Number(_hasInvestor), 0, 'investor was not added'))
        .then(() => fundStorage.getInvestor.call(_investor))
        .then(_investor => assert.strictEqual(Number(_investor[0]), 2, 'incorrect investor type'))
        .catch(assert.throw)
      );
    });

    excluded.forEach((_investor) => {
      it('should not remove non-existent investors', () => fundStorage.removeInvestor.call(_investor, { from: FUND })
        .then(
          () => assert.throw('should removed investor'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0)
        )
        .catch(assert.throw)
      );
    });

    included.sort(() => Math.random() - Math.random());
    included.forEach((_investor) => {
      it('should remove investors', () => fundStorage.removeInvestor(_investor, { from: FUND })
        .then(() => fundStorage.getHasInvestor.call(_investor))
        .then(_hasInvestor => assert.strictEqual(Number(_hasInvestor), 0, 'investor was not removed'))
        .catch(assert.throw)
      );
    });
  });  // describe

  describe('getInvestor', () => {
    it('should return an empty investor', () => fundStorage.getInvestor.call(INVESTOR1)
      .then(_vals =>_vals.map(_val => assert.strictEqual(Number(_val), 0, 'values are non-zero')))
      .catch(assert.throw));
  }); // describe

}); // contract
