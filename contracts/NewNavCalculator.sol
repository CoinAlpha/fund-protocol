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
  function calcShareClassNav(uint _shareClass)
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
    require(_shareClass < fundStorage.numberOfShareClasses());

    // Memory array for temp variables
    uint[9] memory temp;
    /**
     *  [0] = adminFeeBps
     *  [1] = mgmtFeeBps
     *  [2] = performFeeBps
     *  [3] = elapsedTime
     *  [4] = mgmtFee
     *  [5] = adminFee
     *  [6] = performFee
     *  [7] = performFeeOffset
     *  [8] = lossPayback
     */

    // Get Fund and shareClass parameters
    uint shareSupply;
    (temp[0],               // adminFeeBps
     temp[1],               // mgmtFeeBps
     temp[2],               // performFeeBps
     shareSupply  
    ) = fundStorage.getShareClassDetails(_shareClass);

    (lastCalcDate,          // lastCalcDate
     navPerShare,           // navPerShare
     lossCarryforward,      // lossCarryforward
     accumulatedMgmtFees,   // accumulatedMgmtFees
     accumulatedAdminFees   // accumulatedAdminFees
    ) = fundStorage.getShareClassNavDetails(_shareClass);

    // Set the initial value of the variables below from the last NAV calculation
    uint netAssetValue = fundLogic.sharesToUsd(_shareClass, shareSupply);
    temp[3] = now - lastCalcDate;     // elapsedTime
    lastCalcDate = now;

    // The new grossAssetValue equals the updated value, denominated in ether, of the exchange account,
    // plus any amounts that sit in the fund contract, excluding unprocessed subscriptions
    // and unwithdrawn investor payments.
    // Removes the accumulated management and administrative fees from grossAssetValue
    // Prorates total asset value by Share Class share amount / total shares

    // grossAssetValuesLessFees
    uint grossAssetValuesLessFees = dataFeed.value().add(fundLogic.ethToUsd(newFund.getBalance())).sub(accumulatedMgmtFees).sub(accumulatedAdminFees).mul(shareSupply).div(fundStorage.totalShareSupply());

    // Calculates the base management fee accrued since the last NAV calculation
    temp[4] = getAnnualFee(_shareClass, shareSupply, temp[3], temp[1]);   // mgmtFee
    temp[5] = getAnnualFee(_shareClass, shareSupply, temp[3], temp[0]);   // adminFee

    // Calculate the gain/loss based on the new grossAssetValue and the old netAssetValue
    int gainLoss = int(grossAssetValuesLessFees) - int(netAssetValue) - int(temp[4]) - int(temp[5]);

    // If there are performance fees, calculate any fee clawbacks
    if (temp[2] > 0) {
      // if current period gain
      if (gainLoss >= 0) {
        temp[8] = Math.min256(uint(gainLoss), lossCarryforward);                 // lossPayback

        // Update the lossCarryforward and netAssetValue variables
        lossCarryforward = lossCarryforward.sub(temp[8]);
        temp[6] = getPerformFee(temp[2], uint(gainLoss).sub(temp[8]));           // performFee
        netAssetValue = netAssetValue.add(uint(gainLoss)).sub(temp[6]);

      // if current period loss
      } else {
        temp[7] = Math.min256(getPerformFee(temp[2], uint(-1 * gainLoss)), accumulatedMgmtFees);
        // Update the lossCarryforward and netAssetValue variables
        lossCarryforward = lossCarryforward.add(uint(-1 * gainLoss)).sub(getGainGivenPerformFee(temp[7], temp[2]));
        netAssetValue = netAssetValue.sub(uint(-1 * gainLoss)).add(temp[7]);
      }
    }

    // Update the remaining state variables and return them to the fund contract
    accumulatedAdminFees = accumulatedAdminFees.add(temp[5]);
    accumulatedMgmtFees = accumulatedMgmtFees.add(temp[6]).sub(temp[7]);
    navPerShare = toNavPerShare(netAssetValue, shareSupply);

    LogNavCalculation(_shareClass, lastCalcDate, temp[3], grossAssetValuesLessFees, netAssetValue, shareSupply, temp[5], temp[4], temp[6], temp[7], temp[8]);

    // return (lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedAdminFees);
    return (grossAssetValuesLessFees, dataFeed.value(), fundLogic.ethToUsd(newFund.getBalance()), newFund.getBalance(), accumulatedMgmtFees);
  }

  // TODO: TEMP - DEBUGGING
  function getFundBalance()
    constant
    returns (uint)
  {
    return newFund.balance;
  }

  function fundGetBalance()
    constant
    returns (address, uint)
  {
    return (fundAddress, newFund.getBalance());
  }
  // =====================



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

  // Update the address of the data feed contract
  function setFundStorage(address _fundStorageAddress)
    onlyOwner
  {
    fundStorage = IFundStorage(_fundStorageAddress);
    fundStorageAddress = _fundStorageAddress;
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
  function toNavPerShare(uint _nav, uint _shareClassSupply)
    internal 
    constant 
    returns (uint) 
  {
    return _nav.mul(10 ** fundStorage.decimals()).div(_shareClassSupply);
  }
}
