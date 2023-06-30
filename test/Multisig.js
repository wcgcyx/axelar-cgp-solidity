const chai = require('chai');
const { ethers } = require('hardhat');
const {
    utils: { Interface },
} = ethers;
const { expect } = chai;

describe('Multisig', () => {
    let signer1, signer2, signer3;
    let accounts;

    let multisigFactory;
    let multisig;

    let targetFactory;
    let targetContract;

    before(async () => {
        [signer1, signer2, signer3] = await ethers.getSigners();
        accounts = [signer1, signer2, signer3].map((signer) => signer.address);

        multisigFactory = await ethers.getContractFactory('Multisig', signer1);
        targetFactory = await ethers.getContractFactory('Target', signer1);
    });

    beforeEach(async () => {
        multisig = await multisigFactory.deploy(accounts, 2).then((d) => d.deployed());
        targetContract = await targetFactory.deploy().then((d) => d.deployed());
    });

    it('should initialize the mint limiter with signer accounts and threshold', async () => {
        const currentThreshold = 2;

        expect(await multisig.signerThreshold()).to.equal(currentThreshold);
        expect(await multisig.signerAccounts()).to.deep.equal(accounts);
    });

    it('should revert on execute with insufficient value sent', async () => {
        const targetInterface = new Interface(['function callTarget() external']);
        const calldata = targetInterface.encodeFunctionData('callTarget');
        const nativeValue = 1000;

        await multisig
            .connect(signer1)
            .execute(targetContract.address, calldata, nativeValue)
            .then((tx) => tx.wait());

        await expect(multisig.connect(signer2).execute(targetContract.address, calldata, nativeValue)).to.be.revertedWithCustomError(
            multisig,
            'InsufficientBalance',
        );
    });

    it('should revert on execute if call to target fails', async () => {
        // Encode function that does not exist on target
        const targetInterface = new Interface(['function set() external']);
        const calldata = targetInterface.encodeFunctionData('set');
        const nativeValue = 1000;

        await multisig
            .connect(signer1)
            .execute(targetContract.address, calldata, nativeValue)
            .then((tx) => tx.wait());

        await expect(
            multisig.connect(signer2).execute(targetContract.address, calldata, nativeValue, { value: nativeValue }),
        ).to.be.revertedWithCustomError(multisig, 'ExecutionFailed');
    });

    it('should execute function on target contract', async () => {
        const targetInterface = new Interface(['function callTarget() external']);
        const calldata = targetInterface.encodeFunctionData('callTarget');
        const nativeValue = 1000;

        await multisig
            .connect(signer1)
            .execute(targetContract.address, calldata, nativeValue)
            .then((tx) => tx.wait());

        await expect(multisig.connect(signer2).execute(targetContract.address, calldata, nativeValue, { value: nativeValue })).to.emit(
            targetContract,
            'TargetCalled',
        );
    });

    it('should execute function on target contract twice within the same epoch without rotating signers', async () => {
        const targetInterface = new Interface(['function callTarget() external']);
        const calldata = targetInterface.encodeFunctionData('callTarget');
        const nativeValue = 1000;

        await multisig
            .connect(signer1)
            .execute(targetContract.address, calldata, nativeValue)
            .then((tx) => tx.wait());

        await expect(multisig.connect(signer2).execute(targetContract.address, calldata, nativeValue, { value: nativeValue })).to.emit(
            targetContract,
            'TargetCalled',
        );

        await multisig
            .connect(signer1)
            .execute(targetContract.address, calldata, nativeValue)
            .then((tx) => tx.wait());

        await expect(multisig.connect(signer2).execute(targetContract.address, calldata, nativeValue, { value: nativeValue })).to.emit(
            targetContract,
            'TargetCalled',
        );
    });
});