// const Promise = require('bluebird');

// const Fund = artifacts.require("./Fund.sol");
// const NavCalculator = artifacts.require('./NavCalculator.sol');
// const InvestorActions = artifacts.require('./InvestorActions.sol');

// if (typeof web3.eth.getAccountsPromise === "undefined") {
//   Promise.promisifyAll(web3.eth, { suffix: "Promise" });
// }

// contract('Initialize Fund', (accounts) => {
//   // helpers
//   const getBalancePromise = address => web3.eth.getBalancePromise(address);
//   const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
//   const ethToWei = eth => web3.toWei(eth, 'ether');

//   const MANAGER = accounts[0];
//   const EXCHANGE = accounts[1];
//   const DATAFEED = accounts[2];
//   const INITIAL_NAV = web3.toWei(1, 'ether');
//   const MANAGER_INVESTMENT = 1; // 1 ether

//   const MIN_INITIAL_SUBSCRIPTION = 20;
//   const INVESTOR_ALLOCATION = 21;
//   const MIN_SUBSCRIPTION = 5;
//   const MIN_REDEMPTION_SHARES = 5;

//   let fund, navCalculator, investorActions, INITIAL_BALANCE;

//   before(() => Promise.all([
//     NavCalculator.new(DATAFEED, { from: MANAGER }),
//     InvestorActions.new({ from: MANAGER }),
//     getBalancePromise(EXCHANGE)
//   ])
//     .then((results) => {
//       [navCalculator, investorActions, INITIAL_BALANCE] = results;
//       return Fund.new(
//         EXCHANGE,                           // _exchange
//         navCalculator.address,              // _navCalculator
//         investorActions.address,            // investorActions
//         "TestFund",                         // _name
//         "TEST",                             // _symbol
//         4,                                  // _decimals
//         ethToWei(MIN_INITIAL_SUBSCRIPTION), // _minInitialSubscriptionEth
//         ethToWei(MIN_SUBSCRIPTION),         // _minSubscriptionEth
//         ethToWei(MIN_REDEMPTION_SHARES),    // _minRedemptionShares,
//         100,                                // _mgmtFeeBps
//         0,                                  // _performFeeBps
//         { from: MANAGER, value: ethToWei(MANAGER_INVESTMENT) }
//       );
//     })
//     .then((fundInstance) => {
//       fund = fundInstance;
//       return Promise.all([
//         navCalculator.setFund(fund.address),
//         investorActions.setFund(fund.address)
//       ]);
//     })
//     .then(() => Promise.all([
//       navCalculator.fundAddress.call({ from: MANAGER }),
//       investorActions.fundAddress.call({ from: MANAGER })
//     ]))
//     .then(([navFund, investorActionsFund]) => {
//       assert.equal(navFund, fund.address, 'Incorrect fund address in navCalculator');
//       assert.equal(investorActionsFund, fund.address, 'Incorrect fund address in investorActionsFund');
//     })
//     .catch(err => console.log('**** BEFORE ERROR: ', err)));


//   it('should instantiate with the right owner address', () => fund.getOwners()
//     .then(_owners => assert.equal(_owners[0], MANAGER, 'Manager addresses don\'t match'))
//   );

//   it('should instantiate with the right exchange address', () => fund.exchange.call()
//     .then(_exchange => assert.equal(_exchange, EXCHANGE, 'Exchange addresses don\'t match'))
//   );

//   it('should instantiate with the right navCalculator address', () => fund.navCalculator.call()
//     .then(_calculator => assert.equal(_calculator, navCalculator.address, 'Calculator addresses don\'t match'))
//   );

//   it('should instantiate with the right investorActions address', () => fund.investorActions.call()
//     .then(_investorActions => assert.equal(_investorActions, investorActions.address, 'InvestorActions addresses don\'t match'))
//   );

//   it('should instantiate with the right initial NAV', () => fund.navPerShare.call()
//     .then(_nav => assert.equal(_nav, 10000, 'Initial NAV doesn\'t equal 10000'))
//   );

//   it('should instantiate with the right balance', () => {
//     const expected = weiToNum(INITIAL_BALANCE) + MANAGER_INVESTMENT;
//     return fund.balanceOf.call(MANAGER)
//       .then(_bal => {
//         assert.equal(weiToNum(_bal), expected, 'Manager\'s account balance doesn\'t match investment');
//         return fund.totalSupply();
//       })
//       .then(_tokens => assert.equal(weiToNum(_tokens), expected, 'Total supply doesn\'t match manager\'s investment'));
//   });

// });
