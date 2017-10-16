pragma solidity ^0.4.13;

import "./Fund.sol";

library FundHelpers {

  struct Accounts {
    address manager;                      // address of the manager account allowed to withdraw base and performance management fees
    address exchange;                     // address of the exchange account where the manager conducts trading.
  }

  // Update the address of the manager account
  function setManager(Accounts storage self, address _addr)
    returns (bool success)
  {
    require(_addr != address(0));
    address old = self.manager;
    self.manager = _addr;
    return true;
  }
}