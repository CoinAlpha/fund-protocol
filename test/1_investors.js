const path = require('path');

const NavCalculator = artifacts.require('./NavCalculator.sol');
const NewFund = artifacts.require('./NewFund.sol');
const FundLogic = artifacts.require('./FundLogic.sol');

const scriptName = path.basename(__filename);

contract('FundLogic', () => {
  let newFund;
  let navCalculator;
  let fundLogic;

  before(() => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([
      NewFund.deployed(),
      NavCalculator.deployed(),
      FundLogic.deployed()
    ])
      .then(values => [newFund, navCalculator, fundLogic] = values);
  });

  it('should set fund to the correct fund address', () => fundLogic.setFund(newFund.address)
    .then(() => fundLogic.fundAddress.call())
    .then(_fundAddr => assert.equal(_fundAddr, newFund.address, 'fund addresses don\'t match')));
});
