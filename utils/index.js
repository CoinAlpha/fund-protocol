const ethToWei = eth => web3.toWei(eth, 'ether');
const getBalancePromise = address => web3.eth.getBalancePromise(address);

const transferExactAmountPromise = (from, to, _eth) => {
  const tx = {
    from,
    to,
    value: web3.toWei(_eth, 'ether'),
  };

  const gasEstimate = web3.eth.estimateGas(tx);
  const newTx = Object.assign({}, tx, { value: tx.value - gasEstimate });
  return web3.eth.sendTransactionPromise(newTx);
};

const getInvestorData = (_fundStorageInstance, _investor) => _fundStorageInstance.getInvestor.call(_investor)
  .then((_investorData) => {
    const [
      investorType,
      ethPendingSubscription,
      sharesOwned,
      shareClass,
      sharesPendingRedemption,
      amountPendingWithdrawal,
    ] = _investorData.map(x => Number(x));
    const investorData = {
      investorType, ethPendingSubscription, sharesOwned, shareClass, sharesPendingRedemption, amountPendingWithdrawal,
    };
    return investorData;
  })
  .catch(err => assert.throw(`Error getInvestorData: ${err.toString()}`));

const getShareClassData = (_fundStorageInstance, _shareClass) => Promise.all([
  _fundStorageInstance.getShareClassDetails.call(_shareClass),
  _fundStorageInstance.getShareClassNavDetails.call(_shareClass),
])
  .then((_shareClassData) => {
    const [
      adminFeeBps,
      mgmtFeeBps,
      performFeeBps,
      shareSupply,
    ] = _shareClassData[0].map(x => Number(x));

    const [
      lastCalc,
      shareNav,
      lossCarryforward,
      accumulatedMgmtFees,
      accumulatedAdminFees,
    ] = _shareClassData[1].map(x => Number(x));

    const shareClassData = {
      adminFeeBps,
      mgmtFeeBps,
      performFeeBps,
      shareSupply,
      lastCalc,
      shareNav,
      lossCarryforward,
      accumulatedMgmtFees,
      accumulatedAdminFees,
    };
    return shareClassData;
  })
  .catch(err => assert.throw(`Error getShareClassData: ${err.toString()}`));

const hexToString = (hex) => {
  let string = '';
  for (let i = 0; i < hex.length; i += 2) {
    string += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return string;
};

const getContractNumericalData = (label, contractInstance, fields) => Promise.all(fields.map(field => contractInstance[field].call()))
  .then((vals) => {
    const result = {};
    vals.forEach((_val, index) => {
      result[fields[index]] = Number(_val);
    });
    console.log(`${label} Details`);
    console.log(result);
  })
  .catch(err => assert.throw(`Error getting contract field data: ${err.toString()}`));

module.exports = {
  transferExactAmountPromise,
  getInvestorData,
  getContractNumericalData,
  getShareClassData,
  ethToWei,
  getBalancePromise,
};
