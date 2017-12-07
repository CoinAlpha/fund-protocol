const path = require('path');
const Promise = require('bluebird');

const DataFeed = artifacts.require('./DataFeed.sol');

const scriptName = path.basename(__filename);
console.log(`****** START TEST [ ${scriptName} ]*******`);

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

contract('DataFeed', (accounts) => {
  let MANAGER = accounts[0];
  let EXCHANGE = accounts[1];

  let dataFeed;
  let value, usdEth, usdBtc, usdLtc;
  let originalValues;

  const fields = ['value', 'usdEth', 'usdBtc', 'usdEth'];

  const retrieveDataFeedValues = () => Promise.all([
    dataFeed.value.call(),
    dataFeed.usdEth.call(),
    dataFeed.usdBtc.call(),
    dataFeed.usdLtc.call(),
  ]);

  before('before: should prepare', () => DataFeed.deployed()
    .then(_dataFeed => dataFeed = _dataFeed)
    .then(() => dataFeed.updateWithExchange(100))
    .then(txObj => web3.eth.getTransactionReceiptMined(txObj.tx))
    .then(() => retrieveDataFeedValues())
    .then((_vals) => {
      _vals = _vals.map(_val => Number(_val));
      value = _vals[0];
      usdEth = _vals[1];
      usdBtc = _vals[2];
      usdLtc = _vals[3];
      originalValues = [value, usdEth, usdBtc, usdLtc];
      originalValues.forEach((_val, _index) => assert.isDefined(_val, `${fields[_index]} is not defined`));
      if (value === 0) {
        value = 10000000;
        originalValues[0] = value;
        return dataFeed.updateByManager(
          value,
          usdEth,
          usdBtc,
          usdLtc,
          { from: MANAGER }
        )
      }
    })
    .then((txObj) => {
      if (!txObj) throw 'OK';
      return web3.eth.getTransactionReceiptMined(txObj.tx);
    })
    .then(() => dataFeed.value.call())
    .then(_val => value = Number(_val))
    .then(() => assert.isAbove(value, 0, 'initial portfolio value is zero'))
    .catch((err) => {
      if (err !== 'OK') assert.throw(`****** BEFORE: ${err.toString()}`);
    })
  );

  fields.forEach((_field, _index) => {
    describe(`updateValue: ${_field}`, () => {
      it(`should not update: with invalid input`, () => {
        const updateParams = [value, usdEth, usdBtc, usdLtc];
        updateParams[_index] = 0;
        return dataFeed.updateByManager(
          updateParams[0],
          updateParams[1],
          updateParams[2],
          updateParams[3],
          { from: MANAGER }
        )
          .then(
          () => assert.throw('should not have reached here'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0)
          )
      });

      it(`should update: ${_field}`, () => {
        const updateParams = originalValues.slice(0);
        const inputValue = 99999;
        updateParams[_index] = inputValue;
        return dataFeed.updateByManager(
          updateParams[0],
          updateParams[1],
          updateParams[2],
          updateParams[3],
          { from: MANAGER }
        )
          .then(txObj => {
            assert.strictEqual(txObj.logs.length, 1, 'error: too many events logged');
            assert.strictEqual(txObj.logs[0].event, 'LogDataFeedResponse', 'wrong event logged');
            assert.strictEqual(txObj.logs[0].args.rawResult, 'manager update', 'event did not log manager update');
            return web3.eth.getTransactionReceiptMined(txObj.tx);
          })
          .then(receipt => assert.strictEqual(receipt.status, 1, 'function failed'))
          .then(() => retrieveDataFeedValues())
          .then((_vals) => {
            _vals = _vals.map(_val => Number(_val));
            fields.forEach((_field1, _index1) => {
              if (_index1 === _index) {
                assert.strictEqual(_vals[_index1], inputValue, `field: ${_field1} was not updated`);
              } else {
                assert.strictEqual(originalValues[_index1], _vals[_index1], `field: ${_field1} should not have changed`);
              }
            })
          })
          .catch(err => assert.throw(`failed: should have updated ${_field} ${err.toString()}`));
      }); // it
    }); // describe
  }); // fields.forEach

  describe('onlyManager can call', () => {
    const notManagers = accounts.slice(-(accounts.length - 1));
    notManagers.forEach((_notManager, _index) => {
      it(`should not be updated by a non-Manager ${_index}`, () => {
        return dataFeed.updateByManager(
          originalValues[0],
          originalValues[1],
          originalValues[2],
          originalValues[3],
          { from: _notManager }
        )
          .then(
          () => assert.throw('should not have reached here'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0)
          );
      });
    });
  });

  describe('update USD unsubscribed amount', () => {
    const notManager = accounts[accounts.length - 1];
    const usdUnsubscribedAmount = 1000000;

    it('usdUnsubscribedAmount should exist and be initialized to 0', () => {
      assert.isDefined(dataFeed.usdUnsubscribedAmount, 'variable undefined');
      return dataFeed.usdUnsubscribedAmount.call()
        .then(_usdUnsubAmount => assert.strictEqual(Number(_usdUnsubAmount), 0, 'USD unsub was not initialized to 0'))
        .catch(err => assert.throw(`usdUnsubscribedAmount: check variable error: ${err.toString()}`));
    });

    it('should not be updated by a non-Manager', () => dataFeed.updateUsdUnsubscribedAmount(usdUnsubscribedAmount, { from: notManager })
      .then(
      () => assert.throw('should not have updated USD unsub amount'),
      e => assert.isAtLeast(e.message.indexOf('revert'), 0)
      )
    );

    it('manager should be able to change', () => dataFeed.usdUnsubscribedAmount.call()
      .then(_usdUnsubAmount => assert.strictEqual(Number(_usdUnsubAmount), 0, 'USD unsub start amount not equal to zero'))
      .then(() => dataFeed.updateUsdUnsubscribedAmount(usdUnsubscribedAmount, { from: MANAGER }))
      .then((txObj) => {
        assert.strictEqual(txObj.logs.length, 1, 'error: too many events logged');
        assert.strictEqual(txObj.logs[0].event, 'LogUsdUnsubscribedAmountUpdate', 'wrong event logged');
        assert.strictEqual(Number(txObj.logs[0].args.usdUnsubscribedAmount), usdUnsubscribedAmount, 'incorrect amount logged');
        return web3.eth.getTransactionReceiptMined(txObj.tx);
      })
      .then(receipt => assert.strictEqual(receipt.status, 1, 'function failed'))
      .then(() => dataFeed.usdUnsubscribedAmount.call())
      .then(_usdUnsubAmount => assert.strictEqual(Number(_usdUnsubAmount), usdUnsubscribedAmount, 'USD unsub was not updated'))
      .catch(err => assert.throw(`manager update USD unsub amount error: ${err.toString()}`))
    );

    xit('USD unsubscribed amount should be subtracted from value when updating with oraclize', () => {
      return dataFeed.updateUsdUnsubscribedAmount(usdUnsubscribedAmount, { from: MANAGER })
        .then(
        () => assert.throw('should not have reached here'),
        e => assert.isAtLeast(e.message.indexOf('revert'), 0)
        );
    });

  });

  describe('it should update with Oraclize', () => {
    xit('- should not update if Oraclize error', () => {
    });

    it('- should update', () => {
      return dataFeed.updateWithOraclize({ from: MANAGER, value: web3.toWei(0.1, 'ether') })
        .then((txObj) => {
          console.log(JSON.stringify(txObj));
          console.log(txObj);
          console.log(txObj.logs[0].args);
        })
        .catch(err => assert.throw(err.toString()));
    });
  });

}); // contract
