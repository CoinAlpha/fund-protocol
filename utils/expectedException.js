"use strict";

/**
 * @param {!Function.<!Promise>} action.
 * @param {!Number | !string | !BigNumber} gasToUse.
 * @returns {!Promise} which throws unless it hit a valid error.
 */
module.exports = function expectedExceptionPromise(action, gasToUse) {
  return new Promise(function (resolve, reject) {
    try {
      resolve(action());
    } catch (e) {
      reject(e);
    }
  })
    .then(function (txObj) {
      return typeof txObj === "string"
        ? web3.eth.getTransactionReceiptMined(txObj) // regular tx hash
        : typeof txObj.receipt !== "undefined"
          ? txObj.receipt // truffle-contract function call
          : typeof txObj.transactionHash === "string"
            ? web3.eth.getTransactionReceiptMined(txObj.transactionHash) // deployment
            : txObj; // Unknown last case
    })
    .then(
    function (receipt) {
      // We are in Geth
      if (typeof receipt.status !== "undefined") {
        // Byzantium
        assert.strictEqual(receipt.status, "0x0", "should have reverted");
      } else {
        // Pre Byzantium
        assert.equal(receipt.gasUsed, gasToUse, "should have used all the gas");
      }
    },
    function (e) {
      if ((e + "").indexOf("invalid JUMP") > -1 ||
        (e + "").indexOf("out of gas") > -1 ||
        (e + "").indexOf("invalid opcode") > -1 ||
        (e + "").indexOf("revert") > -1) {
        // We are in TestRPC
      } else if ((e + "").indexOf("please check your gas amount") > -1) {
        // We are in Geth for a deployment
      } else {
        throw e;
      }
    }
    );
};