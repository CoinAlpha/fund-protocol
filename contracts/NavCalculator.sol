pragma solidity ^0.4.13;

import "./Fund.sol";
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

contract NavCalculator is DestructibleModified {
  using SafeMath for uint;
  using Math for uint;

  address public fundAddress;

  // Modules
  DataFeed public dataFeed;
  Fund fund;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  function NavCalculator(address _dataFeed)
  {
    dataFeed = DataFeed(_dataFeed);
  }

  event LogNavCalculation(
    uint indexed timestamp,
    uint elapsedTime,
    uint grossAssetValue,
    uint netAssetValue,
    uint totalSupply,
    uint adminFeeInPeriod,
    uint mgmtFeeInPeriod,
    uint performFeeInPeriod,
    uint lossPaybackInPeriod
  );

  // Calculate nav and allocate fees
  function calculate()
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

    // Set the initial value of the variables below from the last NAV calculation
    uint netAssetValue = sharesToUsd(fund.totalSupply());
    uint elapsedTime = now - fund.lastCalcDate();
    lossCarryforward = fund.lossCarryforward();

    // The new grossAssetValue equals the updated value, denominated in ether, of the exchange account,
    // plus any amounts that sit in the fund contract, excluding unprocessed subscriptions
    // and unwithdrawn investor payments.
    uint grossAssetValue = dataFeed.value().add(ethToUsd(fund.getBalance()));

    // Removes the accumulated management fees from grossAssetValue
    uint gpvLessFees = grossAssetValue.sub(fund.accumulatedMgmtFees()).sub(fund.accumulatedAdminFees());

    // Calculates the base management fee accrued since the last NAV calculation
    uint mgmtFee = getAnnualFee(elapsedTime, fund.mgmtFeeBps());
    uint adminFee = getAnnualFee(elapsedTime, fund.adminFeeBps());

    // Calculate the gain/loss based on the new grossAssetValue and the old netAssetValue
    int gainLoss = int(gpvLessFees) - int(netAssetValue) - int(mgmtFee) - int(adminFee);

    // If there's a loss carried forward, apply any gains to it before earning any performance fees
    uint lossPayback = gainLoss > 0
      ? uint(gainLoss).min256(lossCarryforward)
      : 0;
    int gainLossAfterPayback = gainLoss - int(lossPayback);

    // Calculate the performance fee on the gains, if any
    uint performFee = gainLossAfterPayback > 0
      ? getPerformFee(uint(gainLossAfterPayback))
      : 0;
    int netGainLossAfterPerformFee = gainLossAfterPayback + int(lossPayback) - int(performFee);

    // Apply the net gain/losses to the old netAssetValue
    if (netGainLossAfterPerformFee > 0) {
      netAssetValue = netAssetValue.add(uint(netGainLossAfterPerformFee));
    } else {
      netAssetValue = netAssetValue.sub(uint(-1 * netGainLossAfterPerformFee));
    }

    // Update the state variables and return them to the fund contract
    lastCalcDate = now;
    navPerShare = toNavPerShare(netAssetValue);
    accumulatedMgmtFees = fund.accumulatedMgmtFees().add(mgmtFee).add(performFee);
    accumulatedAdminFees = fund.accumulatedAdminFees().add(adminFee);

    lossCarryforward = lossCarryforward.sub(lossPayback);
    if (netGainLossAfterPerformFee < 0) {
      lossCarryforward = lossCarryforward.add(uint(-1 * netGainLossAfterPerformFee));
    }

    LogNavCalculation(lastCalcDate, elapsedTime, grossAssetValue, netAssetValue, fund.totalSupply(), adminFee, mgmtFee, performFee, lossPayback);

    return (lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedAdminFees);
  }

  // ********* ADMIN *********

  // Update the address of the Fund contract
  function setFund(address _address)
    onlyOwner
  {
    fund = Fund(_address);
    fundAddress = _address;
  }

  // Update the address of the data feed contract
  function setDataFeed(address _address)
    onlyOwner
  {
    dataFeed = DataFeed(_address);
  }

  // ********* HELPERS *********

  // Returns the fee amount associated with an annual fee accumulated given time elapsed and the annual fee rate
  // Equivalent to: annual fee percentage * fund totalSupply * (seconds elapsed / seconds in a year)
  // Has the same denomination as the fund totalSupply
  function getAnnualFee(uint elapsedTime, uint annualFeeBps) 
    internal 
    constant 
    returns (uint feePayment) 
  {
    return annualFeeBps.mul(sharesToUsd(fund.totalSupply())).div(10000).mul(elapsedTime).div(31536000);
  }

  // Returns the performance fee for a given gain in portfolio value
  function getPerformFee(uint _usdGain) 
    internal 
    constant 
    returns (uint performFee)  
  {
    return fund.performFeeBps().mul(_usdGain).div(10 ** fund.decimals());
  }

  // Converts shares to a corresponding amount of USD based on the current nav per share
  function sharesToUsd(uint _shares) 
    internal 
    constant 
    returns (uint usd) 
  {
    return _shares.mul(fund.navPerShare()).div(10 ** fund.decimals());
  }

  function ethToUsd(uint _eth) 
    internal 
    constant 
    returns (uint usd) 
  {
    return _eth.mul(dataFeed.usdEth()).div(1e20);
  }

  // Converts total fund NAV to NAV per share
  function toNavPerShare(uint _balance) 
    internal 
    constant 
    returns (uint) 
  {
    return _balance.mul(10 ** fund.decimals()).div(fund.totalSupply());
  }
}
