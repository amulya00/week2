// [assignment] please copy the entire modified custom.test.js here
const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
      // [assignment] complete code here
      const { tornadoPool, token } = await loadFixture(fixture);

      // Alice deposits into tornado pool
      const AliceDepositededAmount = utils.parseEther("0.1");
      const AliceDepositededUtxo = new Utxo({ amount: AliceDepositededAmount });
      await transaction({ tornadoPool, outputs: [AliceDepositededUtxo] });
  
      // Bob gives Alice address to send some eth inside the shielded pool
      const bobKeypair = new Keypair(); // contains private and public keys
      const bobAddress = bobKeypair.address(); // contains only public key
  
      // Alice sends some funds to Bob
      const bobSendAmount = utils.parseEther("0.06");
      const bobSendUtxo = new Utxo({
        amount: bobSendAmount,
        keypair: Keypair.fromString(bobAddress),
      });
      const AliceChangeUtxo = new Utxo({
        amount: AliceDepositededAmount.sub(bobSendAmount),
        keypair: AliceDepositededUtxo.keypair,
      });
      await transaction({
        tornadoPool,
        inputs: [AliceDepositededUtxo],
        outputs: [bobSendUtxo, AliceChangeUtxo],
      });
  
      // Bob parses chain to detect incoming funds
      const filter = tornadoPool.filters.NewCommitment();
      const fromBlock = await ethers.provider.getBlock();
      const events = await tornadoPool.queryFilter(filter, fromBlock.number);
      let bobReceiveUtxo;
      try {
        bobReceiveUtxo = Utxo.decrypt(
          bobKeypair,
          events[0].args.encryptedOutput,
          events[0].args.index
        );
      } catch (e) {
        // we try to decrypt another output here because it shuffles outputs before sending to blockchain
        bobReceiveUtxo = Utxo.decrypt(
          bobKeypair,
          events[1].args.encryptedOutput,
          events[1].args.index
        );
      }
      expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount);
  
      // Bob withdraws a part of his funds from shielded pool
      const bobWithdrawAmount = utils.parseEther("0.05");
      const bobEthAddress = "0x1745b8089E9588c1Ad3F41c02070DFFB4be96eCe";
      const bobChangeUtxo = new Utxo({
        amount: bobSendAmount.sub(bobWithdrawAmount),
        keypair: bobKeypair,
      });
      await transaction({
        tornadoPool,
        inputs: [bobReceiveUtxo],
        outputs: [bobChangeUtxo],
        recipient: bobEthAddress,
      });
  
      const bobBalance = await token.balanceOf(bobEthAddress);
      expect(bobBalance).to.be.equal(bobWithdrawAmount);
    });
  
    it("should deposit from L1 and withdraw to L1", async function () {
      const { tornadoPool, token, omniBridge } = await loadFixture(fixture);
      const AliceKeypair = new Keypair();
      const AliceDepositededAmount = utils.parseEther("0.1");
      const AliceDepositededUtxo = new Utxo({
        amount: AliceDepositededAmount,
        keypair: AliceKeypair,
      });
      const { args, extData } = await prepareTransaction({
        tornadoPool,
        outputs: [AliceDepositededUtxo],
      });
  
      const onTokenBridgedData = encodeDataForBridge({
        proof: args,
        extData,
      });
  
      const onTokenBridgedTx =
        await tornadoPool.populateTransaction.onTokenBridged(
          token.address,
          AliceDepositededUtxo.amount,
          onTokenBridgedData
        );
      await token.transfer(omniBridge.address, AliceDepositededAmount);
      const transferTx = await token.populateTransaction.transfer(
        tornadoPool.address,
        AliceDepositededAmount
      );
  
      await omniBridge.execute([
        { who: token.address, callData: transferTx.data }, // send tokens to pool
        { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
      ]);
  
      const AliceWithdrawAmount = utils.parseEther("0.08");
      const recipient = "0xBb969a1aC436B98Ba599a476c2e0f3be8eeD6fB7";
      const AliceChangeUtxo = new Utxo({
        amount: AliceDepositededAmount.sub(AliceWithdrawAmount),
        keypair: AliceKeypair,
      });
      await transaction({
        tornadoPool,
        inputs: [AliceDepositededUtxo],
        outputs: [AliceChangeUtxo],
        recipient: recipient,
        isL1Withdrawal: false,
      });
  
      const recipientBalance = await token.balanceOf(recipient);
      console.log("receipient balance", recipientBalance.toString());
      expect(recipientBalance).to.be.equal(utils.parseEther("0.08"));
      const omniBridgeBalance = await token.balanceOf(omniBridge.address);
      console.log("omniBridgeBalance", omniBridgeBalance);
      expect(omniBridgeBalance).to.be.equal(0);
  
      const tornadoBalance = await token.balanceOf(tornadoPool.address);
      console.log("tornado Pool Balance ", tornadoBalance.toString());
      expect(tornadoBalance).to.be.equal(utils.parseEther("0.02"));
    });
  



  it('[assignment] iii. see assignment doc for details', async () => {
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture);
    const AliceKeypair = new Keypair(); // contains private and public keys

    const AliceDepositedAmount = utils.parseEther("0.13");
    const AliceDepositedUtxo = new Utxo({
      amount: AliceDepositedAmount,
      keypair: AliceKeypair,
    });
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [AliceDepositedUtxo],
    });

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    });

    const onTokenBridgedTx =
      await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        AliceDepositedUtxo.amount,
        onTokenBridgedData
      );
    await token.transfer(omniBridge.address, AliceDepositedAmount);
    const transferTx = await token.populateTransaction.transfer(
      tornadoPool.address,
      AliceDepositedAmount
    );

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, 
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, 
    ]);

    const bobKeypair = new Keypair(); 
    const bobAddress = bobKeypair.address(); 

    const bobSendAmount = utils.parseEther("0.06");
    const bobSendUtxo = new Utxo({
      amount: bobSendAmount,
      keypair: Keypair.fromString(bobAddress),
    });
    const AliceChangeUtxo = new Utxo({
      amount: AliceDepositedAmount.sub(bobSendAmount),
      keypair: AliceKeypair,
    });
    await transaction({
      tornadoPool,
      inputs: [AliceDepositedUtxo],
      outputs: [bobSendUtxo, AliceChangeUtxo],
    });

    // Bob parses chain to detect incoming funds
    const filter = tornadoPool.filters.NewCommitment();
    const fromBlock = await ethers.provider.getBlock();
    const events = await tornadoPool.queryFilter(filter, fromBlock.number);
    let bobReceiveUtxo;
    try {
      bobReceiveUtxo = Utxo.decrypt(
        bobKeypair,
        events[0].args.encryptedOutput,
        events[0].args.index
      );
    } catch (e) {
     
      bobReceiveUtxo = Utxo.decrypt(
        bobKeypair,
        events[1].args.encryptedOutput,
        events[1].args.index
      );
    }
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount);

    const bobWithdrawAmount = bobReceiveUtxo.amount;
    const bobEthAddress = "0x94F7aB3e94C52A8B937e07531150EAd92680A3d7";
    const bobChangeUtxo = new Utxo({
      amount: bobSendAmount.sub(bobWithdrawAmount),
      keypair: bobKeypair,
    });
    await transaction({
      tornadoPool,
      inputs: [bobReceiveUtxo],
      outputs: [bobChangeUtxo],
      recipient: bobEthAddress,
    });

    const bobBalance = await token.balanceOf(bobEthAddress);

    expect(bobBalance).to.be.equal(bobWithdrawAmount);

    const AliceWithdrawAmount = utils.parseEther("0.06");
    const l1Fee = utils.parseEther("0.01");
 
    const recipient = "0x7157DAc2EcE0f81867E81b415DEeB9547C95642F";
    const AliceUtxoChange = new Utxo({
      amount: AliceDepositedAmount.sub(bobSendAmount).sub(AliceWithdrawAmount),
      keypair: AliceKeypair,
    });

    await transaction({
      tornadoPool,
      inputs: [AliceChangeUtxo],
      outputs: [AliceUtxoChange],
      recipient: recipient,
      isL1Withdrawal: false,
      l1Fee: l1Fee,
    });

    console.log("l1Fee", l1Fee);
    const recipientBalance = await token.balanceOf(recipient);
    expect(recipientBalance).to.be.equal("60000000000000000");

    const bobBal = await token.balanceOf(bobEthAddress);
    expect(bobBal).to.be.equal("60000000000000000");
  })
})
