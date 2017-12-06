const path = require('path');
const Promise = require('bluebird');

const DataFeed = artifacts.require('./DataFeed.sol');

const scriptName = path.basename(__filename);
console.log(`****** START TEST [ ${scriptName} ]*******`);

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

contract('DataFeed', (accounts) => {
  let MANAGER = accounts[0];
  let EXCHANGE = accounts[1];

  let dataFeed;
  let value, usdEth, usdBtc, usdLtc;
  let originalValues;

  const fields = ['value', 'usdEth', 'usdBtc', 'usdEth'];

  const changeExchangeValue = (_multiplier) => {
    return new Promise((resolve, reject) => {
      resolve(
        dataFeed.updateWithExchange(_multiplier)
        // .then(() => dataFeed.value())
        // .then((_val) => console.log("new portfolio value (USD):", parseInt(_val)))
      );
    });
  };

  const retrieveDataFeedValues = () => Promise.all([
    dataFeed.value.call(),
    dataFeed.usdEth.call(),
    dataFeed.usdBtc.call(),
    dataFeed.usdLtc.call(),
  ]);

  before('before: should prepare', () => DataFeed.deployed()
      .then(_dataFeed => dataFeed = _dataFeed)
      .then(() => dataFeed.updateWithExchange(100))
      .then(() => retrieveDataFeedValues())
      .then((_vals) => {
        _vals = _vals.map(_val => Number(_val));
        value = _vals[0];
        usdEth = _vals[1];
        usdBtc = _vals[2];
        usdLtc = _vals[3];
        originalValues = [value, usdEth, usdBtc, usdLtc];
        originalValues.forEach((_val, _index) => assert.isDefined(_val, `${fields[_index]} is not defined`));
      })
      .catch(err => console.error(`****** BEFORE: ${err.toString()}`)));

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
          .then((tx) => {
            assert.strictEqual(tx.logs.length, 1, 'error: too many events logged');
            assert.strictEqual(tx.logs[0].event, 'LogDataFeedResponse', 'wrong event logged');
            assert.strictEqual(tx.logs[0].args.rawResult, 'manager update', 'event did not log manager update');
          })  
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
          .catch(err => assert.throw(`test failed: should have updated ${_field} ${err.toString()}`));
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

  xdescribe('it should update with Oraclize', () => {
    it('- should not update if Oraclize error', () => {
    });

    it('- should update', () => {
    });
  });

}); // contract
