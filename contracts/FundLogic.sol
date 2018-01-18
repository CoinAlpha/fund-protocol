pragma solidity ^0.4.13;

import "./NewFund.sol";
import "./FundStorage.sol";
import "./DataFeed.sol";
import "./zeppelin/DestructibleModified.sol";
import "./math/SafeMath.sol";

/**
 * @title FundLogic
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev This is a supporting module to the Fund contract that contains all the logic for the fund
 * actions, including verification of transactions/conditions and all related calculations.
 * [1] All standard fund calculations, such as share/currency conversions.
 * [2] Investor-related actions such as subscription, redemption, and withdrawals.
 * By performing checks and performing calculations and returning the updated variables to the
 * Fund contract, this module may be upgraded after the inception of the Fund contract.
 */

contract IFundLogic {

  // Fund subscription functions
  function calcWhiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    returns (uint isValid) {}
  function calcRequestEthSubscription(address _addr, uint _amount)
    returns (uint, uint) {}
  function cancelEthSubscription(address _addr)
    returns (uint, uint) {}

  function calcUsdSubscription(address _investor, uint _usdAmount)
    returns (bool) {}
  function calcEthSubscription(address _investor)
    returns (uint ethPendingSubscription, uint newTotalEthPendingSubscription) {}

  function calcSubscriptionShares(address _investor, uint _usdAmount)
    returns (uint, uint, uint, uint, uint, uint) {}
  
  // Fund redemption functions
  function calcRedeemUsdInvestor(address _investor, uint _shares)
    returns (uint, uint, uint, uint, uint) {}
  function calcRequestEthRedemption(address _addr, uint _shares)
    returns (uint, uint) {}
  function cancelEthRedemption(address addr)
    returns (uint, uint) {}
  function calcRedeemEthInvestor(address _investor)
    returns (uint, uint, uint, uint, uint, uint, uint) {}

  // TODO:
  function liquidate(address _addr)
    returns (uint, uint, uint, uint, uint, uint) {}

  function withdraw(address _addr)
    returns (uint, uint, uint) {}
  
  function sharesToEth(uint _shareClass, uint _shares)
    returns (uint ethAmount) {}

  // Admin
  function calcTransferInvestor(address _oldAddress, address _newAddress)
    returns (bool isSuccess) {}
}

contract FundLogic is DestructibleModified {
  using SafeMath for uint;

  address public fundAddress;

  // Modules
  IDataFeed public dataFeed;
  INewFund newFund;
  IFundStorage public fundStorage;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  // ======================================== CONSTRUCTOR ========================================
  function FundLogic(
    address _dataFeed,
    address _fundStorage
  )
  {
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
  }

  /** 
    * Check that whitelist parameters are valid
    * @param  _investor         Investor's ETH wallet address
    * @param  _investorType     [1] Ether investor [2] USD ivnestor
    * @param  _shareClass       Share class index [0] is base class
    * @return isValid           Valid investor to whitelist
    */
  function calcWhiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    onlyFund
    constant
    returns (bool isValid)
  {
    require(_investorType > 0 && _investorType < 3);
    require(fundStorage.getInvestorType(_investor) == 0 && _shareClass < fundStorage.numberOfShareClasses());
    return true;
  }

  /** Register an ETH investor's subscription request, after checking that
    * 1) request is from a whitelisted ETH investor
    * 2) the requested amount > the applicable minimum subscription amount and
    * @param  _investor                           Investor's ETH wallet address
    * @return newEthPendingSubscription           [1] Investor's total ETH amount pending subscription
    * @return newTotalEthPendingSubscription      [2] Fund's new total ETH pending subscription 
    */
  function calcRequestEthSubscription(address _investor, uint _amount)
    onlyFund
    constant
    returns (uint newEthPendingSubscription, uint newTotalEthPendingSubscription)
  {
    var (investorType, ethPendingSubscription, sharesOwned, shareClass) = fundStorage.getSubscriptionShares(_investor);

    require(investorType == 1);

    if (sharesOwned == 0) {
      require(_amount >= fundStorage.minInitialSubscriptionUsd().div(dataFeed.usdEth()).mul(1e18));
    } else {
      require(_amount >= fundStorage.minSubscriptionUsd().div(dataFeed.usdEth()).mul(1e18));
    }

    return (ethPendingSubscription.add(_amount),                        // new investor.ethPendingSubscription
            newFund.totalEthPendingSubscription().add(_amount)          // new totalEthPendingSubscription
           );
  }

  /** Verify and calculate share count and ETH balance impact of an ETH investor's request to cancel a
    * subscriptio request
    * @param  _investor                           Investor's ETH wallet address
    * @return cancelledEthAmount                  [1] Investor's total ETH amount pending subscription
    * @return newTotalEthPendingSubscription      [2] Fund's new total ETH pending subscription 
    */
  function cancelEthSubscription(address _investor)
    onlyFund
    constant
    returns (uint cancelledEthAmount, uint newTotalEthPendingSubscription)
  {
    var (investorType, ethPendingSubscription, sharesOwned, shareClass) = fundStorage.getSubscriptionShares(_investor);

    require(investorType == 1 && ethPendingSubscription > 0);

    return (ethPendingSubscription,                                               // amount cancelled
            newFund.totalEthPendingSubscription().sub(ethPendingSubscription)     // new totalEthPendingSubscription
           );
  }

  /**
    * Check conditions of USD subscription
    * @param  _investor  USD Investor address / UID
    * @param  _usdAmount USD amount of subscription in cents: 1 = $0.01
    * @return isValid
    */
  function calcUsdSubscription(address _investor, uint _usdAmount)
    onlyFund
    constant
    returns (bool)
  {
    var (_investorType, _sharesOwned) = fundStorage.getUsdSubscriptionData(_investor);
    uint minUsdAmount = _sharesOwned == 0 ? fundStorage.minInitialSubscriptionUsd() : fundStorage.minSubscriptionUsd();

    require(_investorType == 2 && _usdAmount >= minUsdAmount);
    return true;
  }

  /**
    * Calculates new shares issued in subscription
    * @param  _investor    Investor UID or ETH Wallet Address
    * @param  _usdAmount   USD amount in cents, 1 = $0.01
    * @return              [1] Share Class index
    *                      [2] New total shares owned by investor
    *                      [3] Newly created shares
    *                      [4] New total supply of share class
    *                      [5] New total share supply of fund
    *                      [6] Subscription NAV in basis points: 1 = 0.01%
    */
  function calcSubscriptionShares(address _investor, uint _usdAmount)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint)
  {
    var (investorType, ethPendingSubscription, sharesOwned, shareClass) = fundStorage.getSubscriptionShares(_investor);

    uint shares;
    if (investorType == 1) {
      // ETH subscribe
      shares = ethToShares(shareClass, ethPendingSubscription);
    } else {
      // USD subscribe
      shares = usdToShares(shareClass, _usdAmount);
    }

    return (shareClass,                                                             
            sharesOwned.add(shares),                                   // new investor.sharesOwned
            shares,                                                    // shares minted
            fundStorage.getShareClassSupply(shareClass).add(shares),   // new Share Class supply
            fundStorage.totalShareSupply().add(shares),                // new totalSupply
            fundStorage.getShareClassNavPerShare(shareClass)           // subscription nav
           );
  }

  /**
    * Calculates new totalEthPendingSubscription and checks for sufficient balance in fund
    * and ETH investor conditions
    * @param  _investor                          ETH wallet address
    * @return newTotalEthPendingSubscription     Fund's new total ETH pending subscription amount
    */
  function calcEthSubscription(address _investor)
    onlyFund
    constant
    returns (uint ethPendingSubscription, uint newTotalEthPendingSubscription)
  {
    var (investorType, _ethPendingSubscription) = fundStorage.getEthSubscriptionData(_investor);
    require(investorType == 1 && _ethPendingSubscription > 0);

    // Check that the fund balance has enough ether because the Fund contract's subscribe
    // function that calls this one will immediately transfer the subscribed amount of ether
    // to the exchange account upon function return
    uint otherPendingSubscriptions = newFund.totalEthPendingSubscription().sub(_ethPendingSubscription);
    require(_ethPendingSubscription <= newFund.balance.sub(otherPendingSubscriptions).sub(newFund.totalEthPendingWithdrawal()));

    return (_ethPendingSubscription, newFund.totalEthPendingSubscription().sub(_ethPendingSubscription));
  }

  // ====================================== REDEMPTIONS ======================================

  /**
    * Calculates change in share ownership for USD investor redemption
    * Confirm valid parameters for redemption
    * @param  _investor    Investor UID or ETH Wallet Address
    * @param  _shares      Amount in 1/100 shares: 1 unit = 0.01 shares
    * @return              [1] Share Class index
    *                      [2] New total net shares owned by investor after redemption
    *                      [3] New total supply of share class
    *                      [4] New total share supply of fund
    *                      [5] Redemption NAV in basis points: 1 = 0.01%
    */

  function calcRedeemUsdInvestor(address _investor, uint _shares)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint)
  {
    require(_shares >= fundStorage.minRedemptionShares());
    var (investorType, shareClass, sharesOwned) = fundStorage.getUsdRedemptionData(_investor);

    require(investorType == 2 && _shares <= sharesOwned);

    return (shareClass,                                                             
            sharesOwned.sub(_shares),                                  // new investor.sharesOwned
            fundStorage.getShareClassSupply(shareClass).sub(_shares),  // new Share Class supply
            fundStorage.totalShareSupply().sub(_shares),               // new totalSupply
            fundStorage.getShareClassNavPerShare(shareClass)           // redemption nav
           );
  }


  /**
    * Calculates ethPendingRedemption nad checks request conditions
    * @param  _investor    Investor UID or ETH Wallet Address
    * @param  _shares      Amount in 1/100 shares: 1 unit = 0.01 shares
    * @return              [1] new sharesPendingRedemption
    *                      [2] totalSharesPendingRedemption
    */

  // Register an investor's redemption request, after checking that
  // 1) the requested amount exceeds the minimum redemption amount and
  // 2) the investor can't redeem more than the shares they own
  function calcRequestEthRedemption(address _investor, uint _shares)
    onlyFund
    constant
    returns (uint, uint)
  {
    require(_shares >= fundStorage.minRedemptionShares());
    var (investorType, sharesOwned, sharesPendingRedemption) = fundStorage.getEthRequestRedemptionData(_investor);

    // Investor's shares owned should be larger than existing redemption requests
    // plus this new redemption request
    require(investorType == 1 && sharesOwned >= _shares.add(sharesPendingRedemption));

    return (sharesPendingRedemption.add(_shares),                                   // new investor.sharesPendingRedemption
            newFund.totalSharesPendingRedemption().add(_shares)                     // new totalSharesPendingRedemption
           );
  }

  // Handles an investor's redemption cancellation, after checking that
  // the fund balance has enough ether to cover the withdrawal.
  // The amount is then moved from sharesPendingRedemption
  function cancelEthRedemption(address _investor)
    onlyFund
    constant
    returns (uint, uint)
  {
    var (investorType, sharesOwned, sharesPendingRedemption) = fundStorage.getEthRequestRedemptionData(_investor);

    // Investor should be an Eth investor and have shares pending redemption
    require(investorType == 1 && sharesPendingRedemption > 0);

    return (sharesPendingRedemption,                                                // new investor.sharesPendingRedemption
            newFund.totalSharesPendingRedemption().sub(sharesPendingRedemption)     // new totalSharesPendingRedemption
           );
  }

  /**
    * Calculates change in share ownership for ETH investor redemption and payment amount
    * Confirm valid parameters for redemption
    * @param  _investor    Investor ETH Wallet Address
    * @return              [1] Share Class index
    *                      [2] Redeemed shares
    *                      [3] New total net shares owned by investor after redemption
    *                      [4] New total supply of share class
    *                      [5] New total share supply of fund
    *                      [6] Redemption NAV in basis points: 1 = 0.01%
    *                      [7] ETH payment amount
    */

  function calcRedeemEthInvestor(address _investor)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint, uint)
  {
    var (investorType, shareClass, sharesOwned, sharesPendingRedemption) = fundStorage.getEthRedemptionData(_investor);
    require(investorType == 1 && sharesPendingRedemption > 0);

    uint ethPayment = sharesToEth(shareClass, sharesPendingRedemption);
    require(ethPayment <= newFund.balance.sub(newFund.totalEthPendingSubscription()).sub(newFund.totalEthPendingWithdrawal()));

    uint nav = fundStorage.getShareClassNavPerShare(shareClass);                       // redemption nav
    return (shareClass,                            
            sharesPendingRedemption,                                                   // shares being redeemed
            sharesOwned.sub(sharesPendingRedemption),                                  // new investor.sharesOwned
            fundStorage.getShareClassSupply(shareClass).sub(sharesPendingRedemption),  // new Share Class supply
            fundStorage.totalShareSupply().sub(sharesPendingRedemption),               // new totalSupply
            nav,                                                                       // redemption nav
            ethPayment                                                                 // amount to be paid to investor
           );
  }

  // Converts all of an investor's shares to ether and makes it available for withdrawal.  Also makes the investor's allocation zero to prevent future investment.
  function liquidate(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint, uint, uint, uint)
  {
    // var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // // Check that the fund balance has enough ether because after this function is processed, the ether
    // // equivalent amount can be withdrawn by the investor.  The fund balance less total withdrawals and other
    // // investors' pending subscriptions should be larger than or equal to the liquidated amount.
    // uint otherPendingSubscriptions = fund.totalEthPendingSubscription().sub(ethPendingSubscription);
    // uint amount = fund.sharesToEth(sharesOwned).add(ethPendingSubscription);
    // require(amount <= fund.balance.sub(fund.totalEthPendingWithdrawal()).sub(otherPendingSubscriptions));

    // return (ethPendingWithdrawal.add(amount),                                   // new investor.ethPendingWithdrawal
    //         sharesOwned,                                                        // shares annihilated
    //         fund.totalEthPendingSubscription().sub(ethPendingSubscription),     // new totalEthPendingSubscription
    //         fund.totalSharesPendingRedemption().sub(sharesPendingRedemption),   // new totalSharesPendingRedemption
    //         fund.totalSupply().sub(sharesOwned),                                // new totalSupply
    //         fund.totalEthPendingWithdrawal().add(amount)                        // new totalEthPendingWithdrawal
    //        );
  }

  // Handles a withdrawal by an investor
  function withdraw(address _addr)
    onlyFund
    constant
    returns (uint, uint, uint)
  {
    // var (ethTotalAllocation, ethPendingSubscription, sharesOwned, sharesPendingRedemption, ethPendingWithdrawal) = fund.getInvestor(_addr);

    // // Check that the fund balance has enough ether to cover the withdrawal after subtracting pending subscriptions
    // // and other investors' withdrawals
    // require(ethPendingWithdrawal != 0);
    // uint otherInvestorPayments = fund.totalEthPendingWithdrawal().sub(ethPendingWithdrawal);
    // require(ethPendingWithdrawal <= fund.balance.sub(fund.totalEthPendingSubscription()).sub(otherInvestorPayments));

    // return (ethPendingWithdrawal,                                               // payment to be sent
    //         0,                                                                  // new investor.ethPendingWithdrawal
    //         fund.totalEthPendingWithdrawal().sub(ethPendingWithdrawal)          // new totalEthPendingWithdrawal
    //         );
  }


  // ********* CONVERSION CALCULATIONS *********

  /**
    * Convert USD cents amount into shares amount
    * @param  _shareClass  Index representing share class: base class = 0 (zero indexed)
    * @param  _usd         USD amount in cents, 1 = $0.01
    * @return _shares      Share amount in decimal units, 1 = 0.01 shares
    */
  function usdToShares(uint _shareClass, uint _usd)
    constant
    returns (uint shares)
  {
    return _usd.mul(10 ** fundStorage.decimals()).div(fundStorage.getShareClassNavPerShare(_shareClass));
  }

  /**
    * Convert Ether amount into shares
    * @param  _shareClass  Index representing share class: base class = 0 (zero indexed)
    * @param  _eth         ETH amount in wei
    * @return _shares      Share amount in decimal units, 1 = 0.01 shares
    */
  function ethToShares(uint _shareClass, uint _eth)
    constant
    returns (uint shares)
  {
    return usdToShares(_shareClass, ethToUsd(_eth));
  }

  /**
    * Convert share amount into USD cents amount
    * @param _shareClass  Index representing share class: base class = 0 (zero indexed)
    * @param _shares      Share amount in decimal units, 1 = 0.01 shares
    * @return usdAmount   USD amount in cents, 1 = $0.01
    */
  function sharesToUsd(uint _shareClass, uint _shares)
    constant
    returns (uint usdAmount)
  {
    return _shares.mul(fundStorage.getShareClassNavPerShare(_shareClass)).div(10 ** fundStorage.decimals());
  }

  /**
    * Convert share amount into Ether
    * @param _shareClass  Index representing share class: base class = 0 (zero indexed)
    * @param _shares      Share amount in decimal units, 1 = 0.01 shares
    * @return ethAmount   ETH amount in wei
    */
  function sharesToEth(uint _shareClass, uint _shares)
    constant
    returns (uint ethAmount)
  {
    return usdToEth(_shares.mul(fundStorage.getShareClassNavPerShare(_shareClass)).div(10 ** fundStorage.decimals()));
  }

  /**
    * Convert USD into ETH
    * @param _usd  USD amount in cents, 1 = $0.01
    * @return eth  ETH amount in wei
    */
  function usdToEth(uint _usd) 
    constant 
    returns (uint ethAmount)
  {
    return _usd.mul(1e18).div(dataFeed.usdEth());
  }

  /**
    * Convert ETH into USD
    * @param  _eth  ETH amount in wei
    * @return usd   USD amount in cents, 1 = $0.01
    */
  function ethToUsd(uint _eth) 
    constant 
    returns (uint usd)
  {
    return _eth.mul(dataFeed.usdEth()).div(1e18);
  }

  // ********* ADMIN *********

  /**
    * Check conditions fo transferring an investor
    * @param  _oldAddress  Existing investor address    
    * @param  _newAddress  New investor address
    * @return isSuccess    Operation successful
    */

  function calcTransferInvestor(address _oldAddress, address _newAddress)
    onlyFund
    returns (bool isSuccess)
  {
    require(_newAddress != address(0));
    require(fundStorage.getInvestorType(_oldAddress) != 0 && fundStorage.getInvestorType(_newAddress) == 0);
    return true;
  }

  // Update the address of the Fund contract
  function setFund(address _fund)
    onlyOwner
    returns (bool success)
  {
    newFund = INewFund(_fund);
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
