pragma solidity 0.4.13;

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
  address exchange;

  // Modules
  DataFeed public valueFeed;
  Fund fund;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  function NavCalculator(
    address _valueFeed
  ) 
  {
    valueFeed = DataFeed(_valueFeed);
  }

  event LogNavCalculation(
    uint indexed timestamp,
    uint elapsedTime,
    uint grossAssetValue,
    uint netAssetValue,
    uint totalSupply,
    uint mgmtFeeInPeriod,
    uint performFeeInPeriod,
    uint lossPaybackInPeriod
  );

  // Calculate nav and allocate fees
  function calculate() onlyFund constant returns (
    uint lastCalcDate,
    uint navPerShare,
    uint lossCarryforward,
    uint accumulatedMgmtFees,
    uint accumulatedPerformFees
  ) {

    // Set the initial value of the variables below from the last NAV calculation
    uint netAssetValue = toEth(fund.totalSupply());
    uint elapsedTime = now - fund.lastCalcDate();
    lossCarryforward = fund.lossCarryforward();
    accumulatedMgmtFees = fund.accumulatedMgmtFees();
    accumulatedPerformFees = fund.accumulatedPerformFees();

    // The new grossAssetValue equals the updated value, denominated in ether, of the exchange account,
    // plus any amounts that sit in the fund contract, excluding unprocessed subscriptions
    // and unwithdrawn investor payments.
    uint grossAssetValue = valueFeed.value().add(fund.balance).sub(fund.totalEthPendingSubscription()).sub(fund.totalEthPendingWithdrawal());

    // Removes the accumulated management fees from grossAssetValue
    uint gpvlessFees = grossAssetValue.sub(accumulatedMgmtFees).sub(accumulatedPerformFees);

    // Calculates the base management fee accrued since the last NAV calculation
    uint mgmtFee = getMgmtFee(elapsedTime);

    // Calculate the gain/loss based on the new grossAssetValue and the old netAssetValue
    int gainLoss = int(gpvlessFees) - int(netAssetValue) - int(mgmtFee);

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
    accumulatedMgmtFees = accumulatedMgmtFees.add(mgmtFee);
    accumulatedPerformFees = accumulatedPerformFees.add(performFee);
    lossCarryforward = lossCarryforward.sub(lossPayback);
    if (netGainLossAfterPerformFee < 0) {
      lossCarryforward = lossCarryforward.add(uint(-1 * netGainLossAfterPerformFee));
    }

    LogNavCalculation(lastCalcDate, elapsedTime, grossAssetValue, netAssetValue, fund.totalSupply(), mgmtFee, performFee, lossPayback);

    return (lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
  }

  // ********* ADMIN *********

  // Update the address of the Fund contract
  function setFund(address ofFund) onlyOwner {
    fund = Fund(ofFund);
    fundAddress = ofFund;
  }

  // Update the address of the data feed contract
  function setValueFeed(address addr) onlyOwner {
    valueFeed = DataFeed(addr);
  }

  // ********* HELPERS *********

  // Returns the management fee accumulated given time elapsed
  // Equivalent to: annual fee percentage * total portfolio value in ether * (seconds elapsed / seconds in a year)
  function getMgmtFee(uint elapsedTime) internal constant returns (uint) {
    return fund.mgmtFeeBps().mul(toEth(fund.totalSupply())).div(10000).mul(elapsedTime).div(31536000);
  }

  // Returns the performance fee for a given gain in portfolio value
  function getPerformFee(uint gain) internal constant returns (uint)  {
    return fund.performFeeBps().mul(gain).div(10000);
  }

  // Converts ether to a corresponding number of shares based on the current nav per share
  function toShares(uint eth) internal constant returns (uint) {
    return eth.mul(10000).div(fund.navPerShare());
  }

  // Converts shares to a corresponding amount of ether based on the current nav per share
  function toEth(uint shares) internal constant returns (uint) {
    return shares.mul(fund.navPerShare()).div(10000);
  }

  // Converts total fund NAV to NAV per share
  function toNavPerShare(uint balance) internal constant returns (uint) {
    return balance.mul(10000).div(fund.totalSupply());
  }
}
