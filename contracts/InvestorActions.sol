pragma solidity ^0.4.13;

import "./Fund.sol";
import "./DataFeed.sol";
import "./zeppelin/DestructibleModified.sol";
import "./math/SafeMath.sol";

/**
 * @title InvestorActions
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev This is a supporting module to the Fund contract that performs investor-related actions
 * such as subscription, redemption, allocation changes, and withdrawals.  By performing checks,
 * performing calculations and returning the updated variables to the Fund contract, this module
 * may be upgraded after the inception of the Fund contract.
 */

contract IInvestorActions {
  function modifyAllocation(address _addr, uint _allocation)
    returns (uint _ethTotalAllocation) {}

  function getAvailableAllocation(address _addr)
    returns (uint ethAvailableAllocation) {}

  function requestSubscription(address _addr, uint _amount)
    returns (uint, uint) {}

  function cancelSubscription(address _addr)
    returns (uint, uint, uint, uint) {}
  
  function subscribe(address _addr)
    returns (uint, uint, uint, uint, uint, uint) {}
  
  function requestRedemption(address _addr, uint _shares)
    returns (uint, uint) {}

  function cancelRedemption(address addr)
    returns (uint, uint) {}

  function redeem(address _addr)
    returns (uint, uint, uint, uint, uint, uint, uint) {}
  
  function liquidate(address _addr)
    returns (uint, uint, uint, uint, uint, uint) {}

  function withdraw(address _addr)
    returns (uint, uint, uint) {}

}

contract InvestorActions is DestructibleModified {
  using SafeMath for uint;

  address public fundAddress;

  // Modules
  IDataFeed public dataFeed;
  IFund fund;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  function InvestorActions(
    address _dataFeed
  )
  {
    dataFeed = IDataFeed(_dataFeed);
  }

  // Modifies the max investment limit allowed for an investor and overwrites the past limit
  // Used for both whitelisting a new investor and modifying an existing investor's allocation
  function modifyAllocation(address _addr, uint _allocation)
    onlyFund
    constant
    returns (uint _ethTotalAllocation)
  {
    require(_allocation > 0);
    return _allocation;
  }

  // Get the remaining available amount in Ether that an investor can subscribe for
  function getAvailableAllocation(address _addr)
    onlyFund
    constant
    returns (uint ethAvailableAllocation)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    uint ethFilledAllocation = ethPendingSubscription.add(fund.sharesToEth(sharesOwned));

    if (ethTotalAllocation > ethFilledAllocation) {
      return ethTotalAllocation.sub(ethFilledAllocation);
    } else {
      return 0;
    }
  }

  // Register an investor's subscription request, after checking that
  // 1) the requested amount exceeds the minimum subscription amount and
  // 2) the investor's total allocation is not exceeded
  function requestSubscription(address _addr, uint _amount)
    onlyFund
    constant
    returns (uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    if (sharesOwned == 0) {
      require(_amount >= fund.minInitialSubscriptionEth());
    } else {
      require(_amount >= fund.minSubscriptionEth());
    }
    require(ethTotalAllocation >= _amount.add(ethPendingSubscription).add(fund.sharesToEth(sharesOwned)));

    return (ethPendingSubscription.add(_amount),                                 // new investor.ethPendingSubscription
            fund.totalEthPendingSubscription().add(_amount)                      // new totalEthPendingSubscription
           );
  }

  // Handles an investor's subscription cancellation, after checking that
  // the fund balance has enough ether to cover the withdrawal.
  // The amount is then moved from ethPendingSubscription to ethPendingWithdrawal
  // so that it can be withdrawn by the investor.
  function cancelSubscription(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    uint otherPendingSubscriptions = fund.totalEthPendingSubscription().sub(ethPendingSubscription);
    require(ethPendingSubscription <= fund.balance.sub(fund.totalEthPendingWithdrawal()).sub(otherPendingSubscriptions));

    return (0,                                                                  // new investor.ethPendingSubscription
            ethPendingWithdrawal.add(ethPendingSubscription),                   // new investor.ethPendingWithdrawal
            fund.totalEthPendingSubscription().sub(ethPendingSubscription),     // new totalEthPendingSubscription
            fund.totalEthPendingWithdrawal().add(ethPendingSubscription)        // new totalEthPendingWithdrawal
           );
  }

  // Processes an investor's subscription request and mints new shares at the current navPerShare
  function subscribe(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // Check that the fund balance has enough ether because the Fund contract's subscribe
    // function that calls this one will immediately transfer the subscribed amount of ether
    // to the exchange account upon function return
    uint otherPendingSubscriptions = fund.totalEthPendingSubscription().sub(ethPendingSubscription);
    require(ethPendingSubscription <= fund.balance.sub(fund.totalEthPendingWithdrawal()).sub(otherPendingSubscriptions));
    uint shares = fund.ethToShares(ethPendingSubscription);

    return (0,                                                                  // new investor.ethPendingSubscription
            sharesOwned.add(shares),                                            // new investor.sharesOwned
            shares,                                                             // shares minted
            ethPendingSubscription,                                             // amount transferred to exchange
            fund.totalSupply().add(shares),                                     // new totalSupply
            fund.totalEthPendingSubscription().sub(ethPendingSubscription)      // new totalEthPendingSubscription
           );
  }

  // Register an investor's redemption request, after checking that
  // 1) the requested amount exceeds the minimum redemption amount and
  // 2) the investor can't redeem more than the shares they own
  function requestRedemption(address _addr, uint _shares)
    onlyFund
    constant
    returns (uint, uint)
  {
    require(_shares >= fund.minRedemptionShares());

    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // Investor's shares owned should be larger than their existing redemption requests
    // plus this new redemption request
    require(sharesOwned >= _shares.add(sharesPendingRedemption));

    return (sharesPendingRedemption.add(_shares),                                // new investor.sharesPendingRedemption
            fund.totalSharesPendingRedemption().add(_shares)                     // new totalSharesPendingRedemption
           );
  }

  // Handles an investor's redemption cancellation, after checking that
  // the fund balance has enough ether to cover the withdrawal.
  // The amount is then moved from sharesPendingRedemption
  function cancelRedemption(address addr)
    onlyFund
    constant
    returns (uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(addr);

    // Check that the total shares pending redemption is greator than the investor's shares pending redemption
    assert(fund.totalSharesPendingRedemption() >= sharesPendingRedemption);

    return (0,                                                                  // new investor.sharesPendingRedemption
            fund.totalSharesPendingRedemption().sub(sharesPendingRedemption)    // new totalSharesPendingRedemption
           );
  }

  // Processes an investor's redemption request and annilates their shares at the current navPerShare
  function redeem(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // Check that the fund balance has enough ether because after this function is processed, the ether
    // equivalent amount can be withdrawn by the investor
    uint amount = fund.sharesToEth(sharesPendingRedemption);
    require(amount <= fund.balance.sub(fund.totalEthPendingSubscription()).sub(fund.totalEthPendingWithdrawal()));

    return (sharesOwned.sub(sharesPendingRedemption),                           // new investor.sharesOwned
            0,                                                                  // new investor.sharesPendingRedemption
            ethPendingWithdrawal.add(amount),                                   // new investor.ethPendingWithdrawal
            sharesPendingRedemption,                                            // shares annihilated
            fund.totalSupply().sub(sharesPendingRedemption),                    // new totalSupply
            fund.totalSharesPendingRedemption().sub(sharesPendingRedemption),   // new totalSharesPendingRedemption
            fund.totalEthPendingWithdrawal().add(amount)                        // new totalEthPendingWithdrawal
          );
  }

  // Converts all of an investor's shares to ether and makes it available for withdrawal.  Also makes the investor's allocation zero to prevent future investment.
  function liquidate(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // Check that the fund balance has enough ether because after this function is processed, the ether
    // equivalent amount can be withdrawn by the investor.  The fund balance less total withdrawals and other
    // investors' pending subscriptions should be larger than or equal to the liquidated amount.
    uint otherPendingSubscriptions = fund.totalEthPendingSubscription().sub(ethPendingSubscription);
    uint amount = fund.sharesToEth(sharesOwned).add(ethPendingSubscription);
    require(amount <= fund.balance.sub(fund.totalEthPendingWithdrawal()).sub(otherPendingSubscriptions));

    return (ethPendingWithdrawal.add(amount),                                   // new investor.ethPendingWithdrawal
            sharesOwned,                                                        // shares annihilated
            fund.totalEthPendingSubscription().sub(ethPendingSubscription),     // new totalEthPendingSubscription
            fund.totalSharesPendingRedemption().sub(sharesPendingRedemption),   // new totalSharesPendingRedemption
            fund.totalSupply().sub(sharesOwned),                                // new totalSupply
            fund.totalEthPendingWithdrawal().add(amount)                        // new totalEthPendingWithdrawal
           );
  }

  // Handles a withdrawal by an investor
  function withdraw(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint)
  {
    var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // Check that the fund balance has enough ether to cover the withdrawal after subtracting pending subscriptions
    // and other investors' withdrawals
    require(ethPendingWithdrawal != 0);
    uint otherInvestorPayments = fund.totalEthPendingWithdrawal().sub(ethPendingWithdrawal);
    require(ethPendingWithdrawal <= fund.balance.sub(fund.totalEthPendingSubscription()).sub(otherInvestorPayments));

    return (ethPendingWithdrawal,                                               // payment to be sent
            0,                                                                  // new investor.ethPendingWithdrawal
            fund.totalEthPendingWithdrawal().sub(ethPendingWithdrawal)          // new totalEthPendingWithdrawal
            );
  }

  // ********* ADMIN *********

  // Update the address of the Fund contract
  function setFund(address _fund)
    onlyOwner
    returns (bool success)
  {
    fund = IFund(_fund);
    fundAddress = _fund;
    return true;
  }

  // Update the address of the data feed contract
  function setDataFeed(address _address) 
    onlyOwner 
    returns (bool success)
  {
    dataFeed = IDataFeed(_address);
    return true;
  }
}
