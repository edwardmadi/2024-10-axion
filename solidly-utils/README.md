# veNFT Utils Documentation

## Introduction
veNFTs are typically held in a multisig wallet, making automation difficult. **veUtils** is a separate contract enabling a single EOA (possibly automated) to execute weekly actions on veNFTs. veUtils provides enhanced security with restricted rights compared to active multisigs, making the protocol more agile by eliminating the need for daily multisig synchronization.

## Architecture
The veUtils system involves both a Master contract and Dex-specific implementations. This structure is due to the fact that all Solidly Dexes have very similar functionalities, though some differences exist, particularly in how rewards are claimed.

- **Master Contract & Dex-Specific Implementations**:
  - **MasterUtils Contract**: 
    - Base contract for voting, bribing, and claiming rewards on solidly-type Dexes.
    - Handles common actions like:
      - Voting and poking votes
      - Claiming bribes and fees
      - Increasing lock times for veNFTs
      - Managing reward notifications for bribes
      - Withdrawing ERC20 and ERC721 tokens to a multisig

## Contract Details & Functions

### MasterUtils Contract Functions

- **Initialize**: Sets up addresses and roles.  
  **Parameters**:
  - `voter_`: Address of the IMasterVoter contract.
  - `admin`: Address that holds the `DEFAULT_ADMIN_ROLE`.
  - `operator`: Address assigned the `OPERATOR_ROLE`.
  - `msig_`: Multisig wallet address for withdrawals.
  - `maxtime_`: Maximum lock time for voting escrow tokens.

- **Voting Functions**:
  - `vote`: Cast a vote with a veNFT on specific pools.
  - `poke`: Update the vote of a given veNFT to keep it active.
  - `checkIncreaseUnlockTime`: Check if the lock time of a veNFT can be increased.
  - `increaseUnlockTime`: Increase lock time for a veNFT.
  - `increaseAmount`: Increase the locked token amount for a specific veNFT.
  - `merge`: Merge two veNFTs.

- **Bribe Functions**:
  - `claimBribes`: Claim bribes for a veNFT from bribe contracts.
  - `claimFees`: Claim fees rewards for a veNFT.
  - `notifyRewardAmounts`: Send bribes on each relevant pool.

- **Withdrawal Functions**:  
  Withdrawals are restricted to the multisig wallet, adding security in case of a compromised key.
  - `msigWithdrawERC20`: Withdraw ERC20 tokens to the multisig wallet.
  - `msigWithdrawERC721`: Withdraw ERC721 tokens to the multisig wallet.

- **Setter Functions**:
  - `setVoter`: Set the voter contract address.
  - `setMsig`: Set the multisig address.
  - `setMaxtime`: Set the maximum lock time for a veNFT.
  - `setBribeTimesPerWeek`: Set the weekly bribe distribution limit.
  - `setBribeAmountLimit`: Set the bribe amount limit for a pair.

### Roles
- **OPERATOR_ROLE**: Can vote and poke in the governance system, claim bribes and fees, notify rewards and manage bribes.
- **WITHDRAWER_ROLE**: Can withdraw ERC20 and ERC721 tokens.
- **SETTER_ROLE**: Can call setter functions.

## Implementations

Each Dex-specific implementation is named **ProtocolName+Utils** (e.g., RamsesUtils, AeroUtils, ThenaUtils), inheriting from `MasterUtils`. These implementations add specific functionalities for claiming rewards in each Dex.

