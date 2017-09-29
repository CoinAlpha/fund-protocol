pragma solidity ^0.4.13;


/**
 * @title OwnableModified
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 * 
 * @dev This modifies the OpenZeppelin Ownable contract to allow for 2 owner addresses.
 * Original contract: https://github.com/OpenZeppelin/zeppelin-solidity/blob/master/contracts/ownership/Ownable.sol
 * The Ownable contract has 1 or 2 owner addresses, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract OwnableModified {
  address[] public owners;
  uint8 maxOwners;


  /**
   * @dev The Ownable constructor sets the original `owner` of the contract to the sender
   * account.
   */
  function OwnableModified() {
    owners.push(msg.sender);
    maxOwners = 2;
  }


  /**
   * @dev Throws if called by any account other than the owner.
   */
  modifier onlyOwner() {
    bool authorized = false;
    for (uint8 i = 0; i < owners.length; i++) {
      if (msg.sender == owners[i]) {
        authorized = true;
      }
    }

    if (!authorized) {
      revert();
    }

    _;
  }

  /**
   * @dev Allows a current owner to add another address that can control of the contract.
   * @param newOwner The address to add ownership rights.
   */
  function addOwner(address newOwner) onlyOwner {
    assert(owners.length < maxOwners);
    if (newOwner != address(0)) {
      owners.push(newOwner);
    }
  }

  function getOwnersLength() onlyOwner constant returns (uint) {
    return owners.length;
  }

  function getOwners() onlyOwner constant returns (address[]) {
    return owners;
  }

  /**
   * @dev Removed in multiple owner version
   *      Allows the current owner to transfer control of the contract to a newOwner.
   * @param newOwner The address to transfer ownership to.
   */
  // function transferOwnership(address newOwner) onlyOwner {
  //   if (newOwner != address(0)) {
  //     owner = newOwner;
  //   }
  // }

}
