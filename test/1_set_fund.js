const path = require('path');

const NewFund = artifacts.require('./NewFund.sol');
const FundStorage = artifacts.require('./FundStorage.sol');
const FundLogic = artifacts.require('./FundLogic.sol');
const NewNavCalculator = artifacts.require('./NewNavCalculator.sol');

const scriptName = path.basename(__filename);

contract('Set Fund', () => {
  let newFund;
  let fundStorage;
  let fundLogic;
  let navCalculator;
  const contractNames = ['FundStorage', 'FundLogic', 'NavCalculator'];
  const contractInstances = {};

  before(() => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([
      FundStorage.deployed(),
      FundLogic.deployed(),
      NewNavCalculator.deployed(),
    ])
      .then(_instances => contractNames.forEach((_contract, index) => contractInstances[_contract] = _instances[index]))
      .then(() => NewFund.deployed())
      .then(_newFund => newFund = _newFund);
  });

  contractNames.forEach((_contract) => {
    it(`should set fund to the correct fund address: ${_contract} `, () => contractInstances[_contract].setFund(newFund.address)
      .then(() => contractInstances[_contract].fundAddress.call())
      .then(_fundAddress => assert.equal(_fundAddress, newFund.address, 'fund addresses don\'t match')));
  });
});
