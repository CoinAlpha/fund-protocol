const Fund = artifacts.require('./Fund.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');

contract('Investors', (accounts) => {
  let fund, navCalculator, investorActions;

  before(() => {
    Promise.all([Fund.deployed(), NavCalculator.deployed(), InvestorActions.deployed()])
    .then(values => {
      [fund, navCalculator, investorActions] = values;
    })
  });

  it('should set fund to the correct fund address', (done) => {
    investorActions.setFund(fund.address)
    .then(() => {
      return investorActions.fundAddress.call();
    }).then((_fund_addr) => {
      assert.equal(_fund_addr, fund.address, 'fund addresses don\'t match');
      done();
    });
  });

});
