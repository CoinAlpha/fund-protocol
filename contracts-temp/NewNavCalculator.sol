pragma solidity ^0.4.13;

import "./NewFund.sol";
import "./FundLogic.sol";
import "./FundStorage.sol";
import "./DataFeed.sol";
import "./math/SafeMath.sol";
import "./math/Math.sol";
import "./zeppelin/DestructibleModified.sol";

/**
 * @title NavCalulator
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev A module for calculating net asset value and other fund variables
 * This is a supporting module to the Fund contract that handles the logic entailed
 * in calculating an updated navPerShare and other fund-related variables given
 * time elapsed and changes in the value of the portfolio, as provided by the data feed.
 */

contract INewNavCalculator {
  function calculate()
    returns (
      uint lastCalcDate,
      uint navPerShare,
      uint lossCarryforward,
      uint accumulatedMgmtFees,
      uint accumulatedAdminFees
    ) {}
}

contract NewNavCalculator is DestructibleModified {
  using SafeMath for uint;
  using Math for uint;

  address public fundAddress;
  address public fundLogicAddress;
  address public fundStorageAddress;

  // Modules
  IDataFeed public dataFeed;
  INewFund newFund;
  IFundLogic fundLogic;
  IFundStorage fundStorage;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  function NewNavCalculator(address _dataFeed, address _fundStorage, address _fundLogic)
  {
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
    fundStorageAddress = _fundStorage;
    fundLogic = IFundLogic(_fundLogic);
    fundLogicAddress = _fundLogic;
  }

  event LogNavCalculation(
    uint shareClass,
    uint indexed timestamp,
    uint elapsedTime,
    uint grossAssetValueLessFees,
    uint netAssetValue,
    uint shareClassSupply,
    uint adminFeeInPeriod,
    uint mgmtFeeInPeriod,
    uint performFeeInPeriod,
    uint performFeeOffsetInPeriod,
    uint lossPaybackInPeriod
  );


  // Calculate nav and allocate fees
  function calcShareClassNav(uint _shareClass)
    onlyFund
    constant
    returns (
      uint lastCalcDate,
      uint navPerShare,
      uint lossCarryforward,
      uint accumulatedMgmtFees,
      uint accumulatedAdminFees
    )
  {
    // Get Fund and shareClass parameters
    uint adminFeeBps;
    uint mgmtFeeBps;
    uint performFeeBps; 
    uint shareSupply;
    (adminFeeBps, mgmtFeeBps, performFeeBps, shareSupply, lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedAdminFees) = fundStorage.getShareClass(_shareClass);

    // Set the initial value of the variables below from the last NAV calculation
    uint netAssetValue = fundLogic.sharesToUsd(_shareClass, shareSupply);
    uint elapsedTime = now - lastCalcDate;
    lastCalcDate = now;

    // The new grossAssetValue equals the updated value, denominated in ether, of the exchange account,
    // plus any amounts that sit in the fund contract, excluding unprocessed subscriptions
    // and unwithdrawn investor payments.
    // Removes the accumulated management and administrative fees from grossAssetValue
    // Prorates total asset value by Share Class share amount / total shares
    uint grossAssetValueLessFees = dataFeed.value().add(fundLogic.ethToUsd(newFund.getBalance())).sub(accumulatedMgmtFees).sub(accumulatedAdminFees).mul(shareSupply).div(fundStorage.totalShareSupply());

    // Calculates the base management fee accrued since the last NAV calculation
    uint mgmtFee = getAnnualFee(_shareClass, shareSupply, elapsedTime, mgmtFeeBps);
    uint adminFee = getAnnualFee(_shareClass, shareSupply, elapsedTime, adminFeeBps);

    // Calculate the gain/loss based on the new grossAssetValue and the old netAssetValue
    int gainLoss = int(grossAssetValueLessFees) - int(netAssetValue) - int(mgmtFee) - int(adminFee);

    uint performFee = 0;
    uint performFeeOffset = 0;

    // if current period gain
    if (gainLoss >= 0) {
      uint lossPayback = Math.min256(uint(gainLoss), lossCarryforward);

      // Update the lossCarryforward and netAssetValue variables
      lossCarryforward = lossCarryforward.sub(lossPayback);
      performFee = getPerformFee(performFeeBps, uint(gainLoss).sub(lossPayback));
      netAssetValue = netAssetValue.add(uint(gainLoss)).sub(performFee);
    
    // if current period loss
    } else {
      performFeeOffset = Math.min256(getPerformFee(performFeeBps, uint(-1 * gainLoss)), accumulatedMgmtFees);
      // Update the lossCarryforward and netAssetValue variables
      lossCarryforward = lossCarryforward.add(uint(-1 * gainLoss)).sub(getGainGivenPerformFee(performFeeOffset, performFeeBps));
      netAssetValue = netAssetValue.sub(uint(-1 * gainLoss)).add(performFeeOffset);
    }

    // Update the remaining state variables and return them to the fund contract
    accumulatedAdminFees = accumulatedAdminFees.add(adminFee);
    accumulatedMgmtFees = accumulatedMgmtFees.add(performFee).sub(performFeeOffset);
    navPerShare = toNavPerShare(netAssetValue, shareSupply);

    LogNavCalculation(_shareClass, lastCalcDate, elapsedTime, grossAssetValueLessFees, netAssetValue, shareSupply, adminFee, mgmtFee, performFee, performFeeOffset, lossPayback);

    return (lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedAdminFees);
  }

  // ********* ADMIN *********

  // Update the address of the Fund contract
  function setFund(address _address)
    onlyOwner
  {
    newFund = INewFund(_address);
    fundAddress = _address;
  }

  // Update the address of the data feed contract
  function setDataFeed(address _address)
    onlyOwner
  {
    dataFeed = IDataFeed(_address);
  }

  // ********* HELPERS *********

  // Returns the fee amount associated with an annual fee accumulated given time elapsed and the annual fee rate
  // Equivalent to: annual fee percentage * fund totalSupply * (seconds elapsed / seconds in a year)
  // Has the same denomination as the fund totalSupply
  function getAnnualFee(uint _shareClass, uint _shareSupply, uint _elapsedTime, uint _annualFeeBps) 
    internal 
    constant 
    returns (uint feePayment) 
  {
    return _annualFeeBps.mul(fundLogic.sharesToUsd(_shareClass, _shareSupply)).div(10000).mul(_elapsedTime).div(31536000);
  }

  // Returns the performance fee for a given gain in portfolio value
  function getPerformFee(uint _performFeeBps, uint _usdGain) 
    internal 
    constant 
    returns (uint performFee)  
  {
    return _performFeeBps.mul(_usdGain).div(10 ** fundStorage.decimals());
  }

  // Returns the gain in portfolio value for a given performance fee
  function getGainGivenPerformFee(uint _performFee, uint _performFeeBps)
    internal 
    constant 
    returns (uint usdGain)  
  {
    return _performFee.mul(10 ** fundStorage.decimals()).div(_performFeeBps);
  }

  // Converts shares to a corresponding amount of USD based on the current nav per share
  // function sharesToUsd(uint _shares) 
  //   internal 
  //   constant 
  //   returns (uint usd) 
  // {
  //   return _shares.mul(newFund.navPerShare()).div(10 ** fundStorage.decimals());
  // }

  // Converts total fund NAV to NAV per share
  function toNavPerShare(uint _balance, uint _shareClassSupply)
    internal 
    constant 
    returns (uint) 
  {
    return _balance.mul(10 ** fundStorage.decimals()).div(_shareClassSupply);
  }
}
