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

const getInvestorData = (fundStorageInstance, investor) => fundStorageInstance.getInvestor.call(investor)
  .then((_investorData) => {
    const [investorType, amountPendingSubscription, sharesOwned, shareClass, sharesPendingRedemption, amountPendingWithdrawal] = _investorData.map(x => Number(x));
    const investorData = { investorType, amountPendingSubscription, sharesOwned, shareClass, sharesPendingRedemption, amountPendingWithdrawal };
    return investorData;
  });

module.exports = {
  transferExactAmountPromise,
  getInvestorData,
}