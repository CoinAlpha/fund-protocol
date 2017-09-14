const Fund = artifacts.require("./Fund.sol");
const NavCalculator = artifacts.require('./NavCalculator.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');

contract('Initialize Fund', (accounts) => {
  // helpers
  const getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber();
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToWei = eth => web3.toWei(eth, 'ether');

  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const INITIAL_NAV = web3.toWei(1, 'ether');
  const MANAGER_INVESTMENT = 1; // 1 ether
  const INITIAL_BALANCE = getBal(EXCHANGE);

  let fund, navCalculator, investorActions;

  before(() => {
    Promise.all([Fund.deployed(), NavCalculator.deployed(), InvestorActions.deployed()])
    .then(values => { [fund, navCalculator, investorActions] = values; })
  });

  it("should instantiate with the right owner address", (done) => {
    fund.getOwners().then(_owners => {
      assert.equal(_owners[0], MANAGER, "Manager addresses don't match")
      done();
    });
  });

  it("should instantiate with the right exchange address", (done) => {
    fund.exchange.call().then(_exchange => {
      assert.equal(_exchange, EXCHANGE, "Exchange addresses don't match")
      done();
    });
  });

  it("should instantiate with the right navCalculator address", (done) => {
    fund.navCalculator.call().then(_calculator => {
      assert.equal(_calculator, navCalculator.address, "Calculator addresses don't match")
      done();
    });
  });

  it("should instantiate with the right investorActions address", (done) => {
    fund.investorActions.call().then(_investorActions => {
      assert.equal(_investorActions, investorActions.address, "InvestorActions addresses don't match")
      done();
    });
  });

  it("should instantiate with the right initial NAV", (done) => {
    fund.navPerShare.call().then(_nav => {
      assert.equal(_nav, 10000, "Initial NAV doesn't equal 10000");
      done();
    });
  });

  it("should instantiate with the right balance", (done) => {
    const expected = INITIAL_BALANCE; //+ MANAGER_INVESTMENT;
    fund.balanceOf.call(MANAGER).then(_bal => {
      assert.equal(weiToNum(_bal), expected, "Manager's account balance doesn't match investment");
      return fund.totalSupply();
    }).then(_tokens => {
      assert.equal(weiToNum(_tokens), expected, "Total supply doesn't match manager's investment");
      done();
    });
  });

});
