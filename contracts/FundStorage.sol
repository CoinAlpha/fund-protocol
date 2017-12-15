pragma solidity ^0.4.13;

import "./Fund.sol";
import "./zeppelin/DestructibleModified.sol";

/**
 * @title FundStorage
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev A module for storing all data for fund
 */

contract FundStorage is DestructibleModified {

  address public fundAddress;

  // Modules
  // IFund fund;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  // This struct tracks fund-related balances for a specific investor address
  struct InvestorStruct {
    uint investorType;                 // [0] no investor [1] ETH investor [2] USD investor 
    uint amountPendingSubscription;    // Ether deposited by an investor not yet proceessed by the manager
    uint sharesOwned;                  // Balance of shares owned by an investor.  For investors, this is
                                       // identical to the ERC20 balances variable.
    uint shareClass;                   // Investor's fee class
    uint sharesPendingRedemption;      // Redemption requests not yet processed by the manager
    uint amountPendingWithdrawal;      // Payments available for withdrawal by an investor
  }

  mapping (address => InvestorStruct) public    investors;
  address[]                                     investorAddresses;
  mapping(address => uint)                      hasInvestor;  // [0] no investor [1] ETH investor [2] USD investor 

  // Events
  event LogSetFundAddress(address oldFundAddress, address newFundAddress);
  event LogAddedInvestor(address newInvestor, uint investorType);
  event LogRemovedInvestor(address removedInvestor, uint investorType);

  // Constructor
  function FundStorage() {
  }

  // [INVESTOR METHOD] Returns the variables contained in the Investor struct for a given address
  function getInvestor(address _investor)
    constant
    public
    returns (
      uint investorType,
      uint amountPendingSubscription,
      uint sharesOwned,
      uint shareClass,
      uint sharesPendingRedemption,
      uint amountPendingWithdrawal
    )
  {
    InvestorStruct storage investor = investors[_investor];
    return (investor.investorType, investor.amountPendingSubscription, investor.sharesOwned, investor.shareClass, investor.sharesPendingRedemption, investor.amountPendingWithdrawal);
  }

  function addInvestor(address _investor, uint _investorType)
    onlyFund
    returns(bool wasAdded)
  {
    require(hasInvestor[_investor] == 0 && _investorType > 0 && _investorType < 3);
    hasInvestor[_investor] = _investorType;
    investorAddresses.push(_investor);
    investors[_investor].investorType = _investorType;
    LogAddedInvestor(_investor, _investorType);
    return true;
  }

  // Remove investor address from list
  function removeInvestor(address _investor)
    onlyFund
    returns (bool success)
  {
    require(hasInvestor[_investor] > 0);
    InvestorStruct storage investor = investors[_investor];

    require(investor.amountPendingSubscription == 0 && investor.sharesOwned == 0 && investor.sharesPendingRedemption == 0 && investor.amountPendingWithdrawal == 0);

    bool investorWasRemoved;
    for (uint i = 0; i < investorAddresses.length; i++) {
      if (_investor == investorAddresses[i]) {
        // If investor is not the last investor, swap with the last
        if (i < investorAddresses.length - 1) {
          investorAddresses[i] = investorAddresses[investorAddresses.length - 1];
        }
        // Remove last investor
        investorAddresses.length = investorAddresses.length - 1;
        investorWasRemoved = true;

        // escape loop
        i = investorAddresses.length;
      }
    }
    if (!investorWasRemoved) {
      revert();
    }
    hasInvestor[_investor] = 0;
    investors[_investor] = InvestorStruct(0,0,0,0,0,0);
    LogRemovedInvestor(_investor, investor.investorType);
    return true;
  }

  function getHasInvestor(address _investor)
    constant
    public
    returns (uint investorType)
  {
    return hasInvestor[_investor];
  }

  function getInvestorAddresses()
    constant
    onlyOwner
    returns (address[])
  {
    return investorAddresses;
  }

  // ********* ADMIN *********

  // Update the address of the Fund contract
  function setFund(address _fundAddress)
    onlyOwner
  {
    address oldFundAddress = fundAddress;
    fundAddress = _fundAddress;
    LogSetFundAddress(oldFundAddress, _fundAddress);
  }

}