const path = require('path');

const NavCalculator = artifacts.require('./NavCalculator.sol');
const NewFund = artifacts.require('./NewFund.sol');
const NewInvestorActions = artifacts.require('./NewInvestorActions.sol');

const scriptName = path.basename(__filename);

contract('NewInvestorActions', () => {
  let newFund;
  let navCalculator;
  let newInvestorActions;

  before(() => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([
      NewFund.deployed(),
      NavCalculator.deployed(),
      NewInvestorActions.deployed()
    ])
      .then(values => [newFund, navCalculator, newInvestorActions] = values);
  });

  it('should set fund to the correct fund address', () => newInvestorActions.setFund(newFund.address)
    .then(() => newInvestorActions.fundAddress.call())
    .then(_fundAddr => assert.equal(_fundAddr, newFund.address, 'fund addresses don\'t match')));
});
