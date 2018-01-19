const path = require('path');
const Promise = require('bluebird');

const FundLogic = artifacts.require('./FundLogic.sol');

const scriptName = path.basename(__filename);

const { ethToWei } = require('../utils');

// DEPLOY PARAMETERS
const { USD_ETH_EXCHANGE_RATE } = require('../config');

const NAV = 100;

const USD_AMOUNT = 100000;

const ETH_AMOUNT = 50;
const WEI_AMOUNT = ethToWei(ETH_AMOUNT);

const USD_SHARES = USD_AMOUNT / (NAV / 100);
const ETH_SHARES = (ETH_AMOUNT * USD_ETH_EXCHANGE_RATE) / (NAV / 100);

contract('Fund Logic', (accounts) => {
  // Contract instances
  let investorActions;

  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return FundLogic.deployed()
      .then(_instance => investorActions = _instance)
      .catch(err => assert.throw(`failed to get instances: ${err.toString()}`));
  });

  describe('Conversion calculations', () => {
    const functions = [
      {
        name: 'usdToEth',
        input1: USD_AMOUNT * 100,
        expected: ethToWei(USD_AMOUNT / USD_ETH_EXCHANGE_RATE),
      },
      {
        name: 'ethToUsd',
        input1: ethToWei(ETH_AMOUNT),
        expected: ETH_AMOUNT * USD_ETH_EXCHANGE_RATE * 100,
      },
      {
        name: 'usdToShares',
        input1: 0,
        input2: USD_AMOUNT * 100,
        expected: USD_SHARES * 100,
      },
      {
        name: 'ethToShares',
        input1: 0,
        input2: ethToWei(ETH_AMOUNT),
        expected: ETH_SHARES * 100,
      },
      {
        name: 'sharesToUsd',
        input1: 0,
        input2: USD_SHARES * 100,
        expected: USD_AMOUNT * 100,
      },
      {
        name: 'sharesToEth',
        input1: 0,
        input2: ETH_SHARES * 100,
        expected: ethToWei(ETH_AMOUNT),
      },
    ];

    const functionCall = params => new Promise((resolve, reject) => {
      let functiontToCall;
      if (params.input2) functiontToCall = () => investorActions[params.name].call(params.input1, params.input2);
      else functiontToCall = () => investorActions[params.name].call(params.input1);
      return functiontToCall()
        .then(_res => resolve(_res))
        .catch(err => resolve(err));
    });

    functions.forEach(params => it(params.name, () => functionCall(params)
      .then(_result => assert.strictEqual(Number(_result), Number(params.expected), 'incorrect amount'))
      .catch(err => assert.throw(`Error ${params.name}: ${err.toString()}`))));
  });  // describe
}); // contract
