import { findFarmerPDA } from "@gemworks/gem-farm-ts"
import { SignerWalletAdapter } from "@solana/wallet-adapter-base"
import { useEffect, useState, useCallback } from "react"
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react"
import { BN } from "@project-serum/anchor"
import { PublicKey } from "@solana/web3.js"

import useWalletNFTs, { NFT } from "hooks/useWalletNFTs"
import { initGemBank } from "lib/gem-farm/common/gem-bank"
import { GemFarm, initGemFarm } from "lib/gem-farm/common/gem-farm"
import { getNFTMetadataForMany } from "lib/gem-farm/common/web3/NFTget"
import { Metadata } from "lib/metadata"
import { GemBank } from "lib/gem-farm/common/gem-bank"

const useGemFarmStaking = (farmId: string) => {
  const { connection } = useConnection()
  const wallet = useAnchorWallet() as SignerWalletAdapter
  const { walletNFTs, refetchNFTs } = useWalletNFTs([
    "9bAVeEj62aBZVspYu5iEo2GSLRzFwLYgEsX5CoeCHN2n",
  ])

  const [farmAccount, setFarmAccount] = useState<any>(null) // @TODO add type to farmAccount
  const [farmerAccount, setFarmerAccount] = useState<any>(null) // @TODO add type to farmerAccount
  const [farmerStatus, setFarmerStatus] = useState<any>(null)
  const [farmerVaultAccount, setFarmerVaultAccount] = useState<any>(null)
  const [farmerVaultNFTs, setFarmerVaultNFTs] = useState<NFT[] | null>(null)
  const [selectedWalletItems, setSelectedWalletItems] = useState<NFT[]>([])
  const [selectedVaultItems, setSelectedVaultItems] = useState<NFT[]>([])
  const [gemBankClient, setGemBankClient] = useState<GemBank | null>(null)
  const [gemFarmClient, setGemFarmClient] = useState<GemFarm | null>(null)

  const fetchFarmerAccount = async (
    farmClient: GemFarm,
    bankClient: GemBank
  ) => {
    if (connection && wallet?.publicKey && farmClient && bankClient) {
      console.log("[Staking Hook] Fetching farmer account...")
      try {
        if (!farmId) throw "No farm ID has been configured."

        const [farmerPDA] = await findFarmerPDA(
          new PublicKey(farmId!),
          wallet?.publicKey
        )

        const farmerAcc = await farmClient.fetchFarmerAcc(farmerPDA)
        setFarmerAccount(farmerAcc)

        const vaultAcc = await bankClient.fetchVaultAcc(farmerAcc.vault)
        setFarmerVaultAccount(vaultAcc)

        const farmerState = farmClient.parseFarmerState(farmerAcc)
        setFarmerStatus(farmerState)
      } catch (e) {
        /**
         * Couldn't fetch farmer; so set it as an empty object
         * For the user to init their farmer account
         */
        console.error(e)
        setFarmerAccount({})
      }
    }
  }

  /**
   * Init clients, farm and farmer account on mount
   */
  useEffect(() => {
    ;(async () => {
      if (connection && wallet?.publicKey) {
        try {
          if (!farmId) throw "No farm ID has been configured."

          console.log("[Staking Hook] Initializing clients...")
          const bankClient = await initGemBank(connection, wallet)
          setGemBankClient(bankClient)

          const farmClient = await initGemFarm(connection, wallet)
          setGemFarmClient(farmClient)

          const farmAcc = await farmClient.fetchFarmAcc(new PublicKey(farmId))
          setFarmAccount(farmAcc as any)

          await fetchFarmerAccount(farmClient, bankClient)
        } catch (e) {
          console.error(e)
        }
      }
    })()
  }, [connection, wallet?.publicKey])

  /**
   * Set Farmer Vault NFTs state
   *
   * Depends on @var farmerAccount
   */
  useEffect(() => {
    const fetchVaultNFTs = async () => {
      if (
        gemBankClient &&
        farmerAccount &&
        farmerAccount?.identity &&
        wallet?.publicKey
      ) {
        try {
          console.log("[Staking Hook] Fetching farmer vault...")

          /**
           * Fetch GDR (Gem Deposit Receipts) from the farmer vault
           */
          const foundGDRs = await gemBankClient.fetchAllGdrPDAs(
            farmerAccount.vault
          )

          const mints = foundGDRs.map((gdr: any) => {
            return { mint: gdr.account.gemMint }
          })

          /** Fetch metadatas for Vault NFTs */
          const currentVaultNFTs = await getNFTMetadataForMany(
            mints,
            connection
          )

          /** Transform to use on the UI */
          const transformedVaultNFTs = currentVaultNFTs.map((nft) => ({
            onChain: {
              metaData: nft.onchainMetadata,
              tokenAccount: nft.pubkey,
            } as {
              metaData: Metadata
              tokenAccount: PublicKey
            },
            offChain: nft.externalMetadata as any,
          }))

          /**
           * Set Vault NFTs state
           */
          setFarmerVaultNFTs(transformedVaultNFTs)
        } catch (e) {
          console.log(e)
        }
      }
    }

    if (gemBankClient && farmerAccount && wallet?.publicKey) {
      fetchVaultNFTs()
    }
  }, [wallet?.publicKey, gemBankClient, farmerAccount])

  /**
   * Handles selected items.
   */
  const handleWalletItemClick = (item: NFT) => {
    setSelectedWalletItems((prev) => {
      const exists = prev.find(
        (NFT) => NFT.onChain.metaData.mint === item.onChain.metaData.mint
      )

      /** Remove if exists */
      if (exists) {
        return prev.filter(
          (NFT) => NFT.onChain.metaData.mint !== item.onChain.metaData.mint
        )
      }

      return prev?.concat(item)
    })
  }

  const handleVaultItemClick = (item: NFT) => {
    setSelectedVaultItems((prev) => {
      const exists = prev.find(
        (NFT) => NFT.onChain.metaData.mint === item.onChain.metaData.mint
      )

      /** Remove if exists */
      if (exists) {
        return prev.filter(
          (NFT) => NFT.onChain.metaData.mint !== item.onChain.metaData.mint
        )
      }

      return prev?.concat(item)
    })
  }

  const depositGem = async (
    mint: PublicKey,
    creator: PublicKey,
    source: PublicKey
  ) => {
    if (!gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemBankClient.depositGemWallet(
      new PublicKey(farmAccount.bank),
      new PublicKey(farmerAccount.vault),
      new BN(1),
      mint,
      source,
      creator
    )

    await connection.confirmTransaction(txSig)
    console.log("[Staking Hook] deposit done", txSig)

    return txSig
  }

  const withdrawGem = async (mint: PublicKey) => {
    if (!gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemBankClient.withdrawGemWallet(
      farmAccount.bank,
      farmerAccount.vault,
      new BN(1),
      mint
    )

    await connection.confirmTransaction(txSig)
    console.log("[Staking Hook] withdrawal done", txSig)

    return txSig
  }

  const handleMoveToVaultButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    for (const nft of selectedWalletItems) {
      const creator = new PublicKey(
        nft.onChain.metaData.data.creators?.[0].address || ""
      )

      await depositGem(
        new PublicKey(nft.onChain.metaData.mint),
        creator,
        new PublicKey(nft.onChain.tokenAccount)
      )
    }

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()

    setSelectedVaultItems([])
    setSelectedWalletItems([])
  }

  const handleMoveToWalletButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    for (const nft of selectedVaultItems) {
      await withdrawGem(new PublicKey(nft.onChain.metaData.mint))
    }

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()

    setSelectedVaultItems([])
    setSelectedWalletItems([])
  }

  const handleStakeButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemFarmClient.stakeWallet(new PublicKey(farmId!))

    await connection.confirmTransaction(txSig)

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()

    // selectedNFTs.value = [];
  }

  const handleUnstakeButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemFarmClient.unstakeWallet(new PublicKey(farmId!))

    await connection.confirmTransaction(txSig)

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()
    // selectedNFTs.value = [];
  }

  const handleClaimButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemFarmClient.claimWallet(
      new PublicKey(farmId),
      new PublicKey(farmAccount.rewardA.rewardMint!),
      new PublicKey(farmAccount.rewardB.rewardMint!)
    )

    await connection.confirmTransaction(txSig)

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()
    // await fetchFarmer();
  }

  const handleInitStakingButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient)
      throw new Error("No Gem Bank client has been initialized.")

    const { txSig } = await gemFarmClient.initFarmerWallet(
      new PublicKey(farmId)
    )

    await connection.confirmTransaction(txSig)
    // await fetchFarmer();
    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()
  }

  const handleRefreshRewardsButtonClick = async () => {
    if (!gemFarmClient || !gemBankClient || !farmerAccount.identity) return true

    console.log("[Staking Hook] Refreshing farmer...")
    const { txSig } = await gemFarmClient.refreshFarmerWallet(
      new PublicKey(farmId),
      farmerAccount.identity
    )

    await connection.confirmTransaction(txSig)

    await fetchFarmerAccount(gemFarmClient, gemBankClient)
    await refetchNFTs()
  }

  return {
    walletNFTs,
    farmerAccount,
    farmerVaultAccount,
    farmerStatus,
    selectedWalletItems,
    handleStakeButtonClick,
    handleUnstakeButtonClick,
    handleClaimButtonClick,
    handleWalletItemClick,
    handleMoveToVaultButtonClick,
    handleInitStakingButtonClick,
    farmerVaultNFTs,
    selectedVaultItems,
    handleMoveToWalletButtonClick,
    handleVaultItemClick,
    handleRefreshRewardsButtonClick,
  }
}

export default useGemFarmStaking
