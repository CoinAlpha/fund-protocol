const expectedExceptionPromise = require('../utils/expectedException.js');
web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

const allArtifacts = {
  OwnableModified: artifacts.require('./OwnableModified.sol'),
  Fund: artifacts.require('./Fund.sol'),
  NavCalculator: artifacts.require('./NavCalculator.sol'),
  InvestorActions: artifacts.require('./InvestorActions.sol')
};

const constructors = {
  OwnableModified: owner => allArtifacts.OwnableModified.new({ from: owner }),
  Fund: (owner, exchange, navCalculator, investorActions) =>
    allArtifacts.OwnableModified.new(
      exchange,                 // _exchange
      navCalculator,            // _navCalculator
      investorActions,          // investorActions
      'FundName',               // _name
      'SYMB',                   // _symbol
      4,                        // _decimals
      20e18,                    // _minInitialSubscriptionEth
      5e18,                     // _minSubscriptionEth
      5e18,                     // _minRedemptionShares,
      100,                      // _mgmtFeeBps
      0,                        // _performFeeBps
      { from: owner }
    ),
  NavCalculator: (owner, dataFeed) => allArtifacts.NavCalculator.new(dataFeed, { from: owner }),
  InvestorActions: owner => allArtifacts.InvestorActions.new({ from: owner })
};

contract('OwnableModified', (accounts) => {
  let owner0;
  let owner1;
  let owner2;
  let owner3;
  let notOwner0;
  let notOwnerAddress0;
  let notOwnerAddress1;
  let notOwnerAddress2;
  let notOwnerAddress3;
  let owned;
  const addressZero = '0x0000000000000000000000000000000000000000';

  before('should prepare', () => {
    assert.isAtLeast(accounts.length, 2);
    [
      owner0,
      owner1,
      owner2,
      owner3,
      notOwner0,
      notOwnerAddress0,
      notOwnerAddress1,
      notOwnerAddress2,
      notOwnerAddress3
    ] = accounts;
  });

  Object.keys(constructors).forEach((name) => {
    describe(name, () => {
      beforeEach(`should deploy a new ${name}`, () => constructors[name](owner0, notOwnerAddress0, notOwnerAddress1, notOwnerAddress2)
        .then(instance => owned = instance));

      describe('getOwners', () => {
        it('should have correct initial value', () => owned.getOwners()
          .then(owners => assert.strictEqual(owners[0], owner0)));

        it('should be possible to ask for owner from any address', () => owned.getOwners({ from: notOwner0 })
          .then(owners => assert.strictEqual(owners[0], owner0)));

        it('should be possible to send a transaction to getOwner', () => owned.getOwners.sendTransaction({ from: owner1 })
          .then(tx => web3.eth.getTransactionReceiptMined(tx))
          .then(receipt => assert.strictEqual(receipt.logs.length, 0))
          .then(() => owned.getOwners())
          .then(owners => assert.strictEqual(owners[0], owner0)));

        it('should not be possible to send a transaction with value to getOwners', () => owned.getOwners.sendTransaction({ from: owner1, value: 1 })
          .then(
            () => assert.throw('should not have reached here'),
            e => assert.isAtLeast(e.message.indexOf('non-payable function'), 0)
          ));
      });

      describe('addOwner', () => {
        it('should be possible to add another owner', () => owned.addOwner(owner1, { from: owner0 })
          .then(txObj => web3.eth.getTransactionReceiptMined(txObj.tx))
          .then(receipt => assert.strictEqual(receipt.logs.length, 1))
          .then(() => owned.getOwners())
          .then(owners => assert.strictEqual(owners[1], owner1)));

        it('should not be possible to add a third owner', () => owned.addOwner(owner1, { from: owner0 })
          .then(txObj => web3.eth.getTransactionReceiptMined(txObj.tx))
          .then((receipt) => {
            console.log(receipt.logs);
            assert.strictEqual(receipt.logs.length, 1);
            return owned.addOwner(owner2, { from: owner0 });
          })
          .then(
            () => assert.throw('should not have reached here; do not add 3rd owner'),
            e => assert.isAtLeast(e.message.indexOf('invalid opcode'), 0)
          ));
      });

      describe('transferOwnership', () => {
        it('should not be possible to set owner if asking from wrong owner', () => expectedExceptionPromise(
          () => owned.transferOwnership(owner2, { from: notOwner0, gas: 3000000 }),
          3000000
        ));

        it('should not be possible to set owner if to 0', () => expectedExceptionPromise(
          () => owned.transferOwnership(addressZero, { from: owner0, gas: 3000000 }),
          3000000
        ));

        it('should not be possible to set owner if no change', () => expectedExceptionPromise(
          () => owned.transferOwnership(owner0, { from: owner0, gas: 3000000 }),
          3000000
        ));

        it('should not be possible to set owner if pass value', () => owned.transferOwnership(owner2, { from: owner0, value: 1 })
          .then(
            () => assert.throw('should not have reached here'),
            e => assert.isAtLeast(e.message.indexOf('non-payable function'), 0)
          ));

        it('should be possible to transfer ownership', () => owned.transferOwnership.call(owner1, { from: owner0 })
          .then(success => assert.isTrue(success))
          // owner0 transfers ownership to owner1
          .then(() => owned.transferOwnership(owner1, { from: owner0 }))
          .then((tx) => {
            assert.strictEqual(tx.receipt.logs.length, 1);
            assert.strictEqual(tx.logs.length, 1);
            const logChanged = tx.logs[0];
            assert.strictEqual(logChanged.event, 'LogOwnershipTransferred');
            assert.strictEqual(logChanged.args.previousOwner, owner0);
            assert.strictEqual(logChanged.args.newOwner, owner1);
            // owner1 adds owner2
            return owned.addOwner(owner2, { from: owner1 });
          })
          // owner2 transfers to owner3
          .then(() => owned.transferOwnership(owner3, { from: owner2 }))
          .then(tx => owned.getOwners())
          .then((owners) => {
            assert.strictEqual(owners[0], owner1);
            assert.strictEqual(owners[1], owner3);
          }));
      });
    });
  });

  it('should have correct number of functions', () => constructors.OwnableModified(owner0)
    .then(owned => assert.strictEqual(Object.keys(owned).length, 15)));
  // Expected: [ 'constructor','abi','contract','owners','getOwnersLength','addOwner','getOwners','transferOwnership','LogOwnershipTransferred','LogOwnerAdded', 'sendTransaction','send','allEvents','address','transactionHash' ]
});
