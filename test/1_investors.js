const path = require('path');

const Fund = artifacts.require('./Fund.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');

const scriptName = path.basename(__filename);
console.log(`****** START TEST [ ${scriptName} ]*******`);

contract('Investors', () => {
  let fund;
  let navCalculator;
  let investorActions;

  before(() => Promise.all([
    Fund.deployed(),
    NavCalculator.deployed(),
    InvestorActions.deployed()
  ])
    .then(values => [fund, navCalculator, investorActions] = values));

  it('should set fund to the correct fund address', () => investorActions.setFund(fund.address)
    .then(() => investorActions.fundAddress.call())
    .then(_fundAddr => assert.equal(_fundAddr, fund.address, 'fund addresses don\'t match')));
});
