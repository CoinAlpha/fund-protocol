const path = require('path');

const expectedExceptionPromise = require('../utils/expectedException.js');
web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

const allArtifacts = {
  OwnableModified: artifacts.require('./OwnableModified.sol'),
  NavCalculator: artifacts.require('./NavCalculator.sol'),
  InvestorActions: artifacts.require('./InvestorActions.sol'),
  DataFeed: artifacts.require('./DataFeed.sol'),
  FundStorage: artifacts.require('./FundStorage.sol'),
  Fund: artifacts.require('./Fund.sol'),
};

const scriptName = path.basename(__filename);

const ethToWei = eth => web3.toWei(eth, 'ether');

const constructors = {
  OwnableModified: owner => allArtifacts.OwnableModified.new({ from: owner }),
  DataFeed: (owner, exchange) => allArtifacts.DataFeed.new(
    '[NOT USED]',                 // _queryUrl
    300,                          // _secondsBetweenQueries
    300 * 100,                    // _initialUsdEthRate
    10000 * 100,                  // _initialUsdBtcRate
    100 * 100,                    // _initialUsdLtcRate
    exchange,                     // _exchange
    { from: owner, value: 0 }
  ),
  NavCalculator: (owner, dataFeed) => allArtifacts.NavCalculator.new(dataFeed, { from: owner }),
  InvestorActions: (owner, dataFeed) => allArtifacts.InvestorActions.new(dataFeed, { from: owner }),
  FundStorage: (owner, dataFeed) => allArtifacts.FundStorage.new({ from: owner }),
  Fund: (owner, exchange, navCalculator, investorActions, dataFeed, fundStorage) =>
    allArtifacts.Fund.new(
      owner,                     // _manager
      exchange,                  // _exchange
      navCalculator.address,     // _navCalculator
      investorActions.address,   // _investorActions
      dataFeed.address,          // _dataFeed
      fundStorage.address,       // _fundStorage
      'TestFund',                // _name
      'TEST',                    // _symbol
      4,                         // _decimals
      ethToWei(20),              // _minInitialSubscriptionEth
      ethToWei(5),               // _minSubscriptionEth
      100000,                    // _minRedemptionShares,
      100,                       // _adminFeeBps
      100,                       // _mgmtFeeBps
      2000,                      // _performFeeBps
      30000,                     // _managerUsdEthBasis
      { from: owner }
    ),
};

contract('OwnableModified', (accounts) => {
  let owned, dataFeed, navCalculator, investorActions, fundStorage;
  const [
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

  const addressZero = '0x0000000000000000000000000000000000000000';

  before('should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ]*******`);
    assert.isAtLeast(accounts.length, 5);
  });

  Object.keys(constructors).forEach((name) => {
    describe(name, () => {

      before(`should deploy a new ${name}`, () => {
        if (name === 'OwnableModified') {
          return constructors[name](owner0, notOwnerAddress0, navCalculator, investorActions, dataFeed)
            .then(instance => owned = instance);
        } else if (name === 'DataFeed') {
          return constructors[name](owner0, notOwnerAddress0)
            .then((instance) => {
              owned = instance;
              dataFeed = instance;
            });
        } else if (name === 'Fund') {
          return constructors[name](owner0, notOwnerAddress0, navCalculator, investorActions, dataFeed, fundStorage)
            .then(instance => owned = instance);
        } else {
          return constructors[name](owner0, dataFeed.address)
            .then((instance) => {
              owned = instance;
              switch (name) {
                case 'NavCalculator':
                  navCalculator = instance;
                  break;
                case 'InvestorActions':
                  investorActions = instance;
                  break;
                case 'FundStorage':
                  fundStorage = instance;
                  break;
                default:
                  break;
              }
            });
        }
      })

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

        it('should not be possible to add a third owner', () => owned.addOwner(owner2, { from: owner0 })
          .then(
            () => assert.throw('should not have reached here'),
            e => assert.isAtLeast(e.message.indexOf('revert'), 0)
          ));
      });

      describe('transferOwnership', () => {
        it('should not be possible to set owner if asking from wrong owner', () =>
          owned.transferOwnership(owner2, { from: notOwner0, gas: 3000000 })
            .then(
              () => assert.throw('should not have reached here'),
              e => assert.isAtLeast(e.message.indexOf('revert'), 0)
            ));

        it('should not be possible to set owner if to 0', () =>
          owned.transferOwnership(addressZero, { from: owner0, gas: 3000000 })
            .then(
              () => assert.throw('should not have reached here'),
              e => assert.isAtLeast(e.message.indexOf('revert'), 0)
            ));

        it('should not be possible to transfer ownership to sender account', () =>
          owned.transferOwnership(owner0, { from: owner0, gas: 3000000 })
            .then(
              () => assert.throw('should not have reached here'),
              e => assert.isAtLeast(e.message.indexOf('revert'), 0)
            ));

        it('should not be possible to set owner if pass value', () => owned.transferOwnership(owner2, { from: owner0, value: 1 })
          .then(
            () => assert.throw('should not have reached here'),
            e => assert.isAtLeast(e.message.indexOf('non-payable function'), 0)
          ));

        it('should be possible to transfer ownership', () => owned.transferOwnership.call(owner2, { from: owner0 })
          .then(success => assert.isTrue(success))
          // owner0 transfers ownership to owner1
          .then(() => owned.transferOwnership(owner2, { from: owner0 }))
          .then((tx) => {
            assert.strictEqual(tx.receipt.logs.length, 1);
            assert.strictEqual(tx.logs.length, 1);
            const logChanged = tx.logs[0];
            assert.strictEqual(logChanged.event, 'LogOwnershipTransferred');
            assert.strictEqual(logChanged.args.previousOwner, owner0);
            assert.strictEqual(logChanged.args.newOwner, owner2);
          })
          // owner2 transfers to owner3
          .then(() => owned.transferOwnership(owner3, { from: owner2 }))
          .then(tx => owned.getOwners())
          .then((owners) => {
            assert.strictEqual(owners[0], owner3);
            assert.strictEqual(owners[1], owner1);
          }));
      });
    });
  });

  it('should have correct number of functions', () => constructors.OwnableModified(owner0)
    .then(owned => assert.strictEqual(Object.keys(owned).length, 15)));
  // Expected: [ 'constructor','abi','contract','owners','getOwnersLength','addOwner','getOwners','transferOwnership','LogOwnershipTransferred','LogOwnerAdded', 'sendTransaction','send','allEvents','address','transactionHash' ]
});
