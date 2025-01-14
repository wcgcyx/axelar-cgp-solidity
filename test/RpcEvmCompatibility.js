'use strict';

const chai = require('chai');
const { ethers, network } = require('hardhat');
const {
    utils: { hexValue, getAddress, keccak256 },
    Wallet,
    BigNumber,
} = ethers;
const { expect } = chai;

const { isHardhat, getRandomInt, waitFor, getGasOptions } = require('./utils');

const TestRpcCompatibility = require('../artifacts/contracts/test/TestRpcCompatibility.sol/TestRpcCompatibility.json');

describe('EVM RPC Compatibility Test', () => {
    const maxTransferAmount = 100;

    let provider;
    let signer;
    let transferAmount;
    let rpcCompatibilityFactory;
    let rpcCompatibilityContract;

    async function checkReceipt(receipt, value) {
        const topic = keccak256(ethers.utils.toUtf8Bytes('ValueUpdated(uint256)'));

        expect(receipt).to.not.be.null;
        expect(receipt.from).to.equal(signer.address);
        expect(receipt.to).to.equal(rpcCompatibilityContract.address);
        expect(receipt.status).to.equal(1);
        expect(receipt.logs[0].topics[0]).to.equal(topic);
        expect(parseInt(receipt.logs[0].topics[1], 16)).to.equal(value);
    }

    function checkBlockTimeStamp(timeStamp, maxDifference) {
        const currentTime = Math.floor(Date.now() / 1000);
        const timeDifference = Math.abs(currentTime - timeStamp);
        expect(timeDifference).to.be.lessThan(maxDifference);
    }

    before(async () => {
        provider = ethers.provider;
        [signer] = await ethers.getSigners();

        rpcCompatibilityFactory = await ethers.getContractFactory('TestRpcCompatibility', signer);
        rpcCompatibilityContract = await rpcCompatibilityFactory.deploy();
        await rpcCompatibilityContract.deployTransaction.wait(network.config.confirmations);

        transferAmount = getRandomInt(maxTransferAmount);
    });

    describe('eth_getLogs', () => {
        const newValue = 100;
        let blockNumber;

        async function checkLog(filter) {
            const log = await provider.send('eth_getLogs', [filter]);

            expect(log).to.be.an('array');
            expect(log.length).to.be.at.least(0);

            if (filter.topics) {
                const found = log.some((item) => item.topics && item.topics[0] === filter.topics[0]);
                expect(found).to.equal(true);
            }
        }

        before(async () => {
            const receipt = await rpcCompatibilityContract.updateValue(newValue).then((tx) => tx.wait());
            blockNumber = hexValue(receipt.blockNumber);
        });

        it('should support RPC method eth_getLogs', async () => {
            const expectedTopic = keccak256(ethers.utils.toUtf8Bytes('ValueUpdated(uint256)'));

            let filter = {
                fromBlock: blockNumber,
                toBlock: blockNumber,
                address: [rpcCompatibilityContract.address],
                topics: [expectedTopic],
            };
            await checkLog(filter);

            filter = {
                fromBlock: blockNumber,
                toBlock: 'latest',
                address: [rpcCompatibilityContract.address],
                topics: [expectedTopic],
            };
            await checkLog(filter);
        });

        it('supports safe tag', async () => {
            const filter = {
                fromBlock: blockNumber,
                toBlock: 'safe',
            };
            await checkLog(filter);
        });

        it('supports finalized tag', async () => {
            const filter = {
                fromBlock: isHardhat ? hexValue(0) : hexValue(parseInt(blockNumber, 16) - 100),
                toBlock: 'finalized',
            };
            await checkLog(filter);
        });
    });

    describe('rpc get transaction and blockByHash methods', () => {
        let tx;

        before(async () => {
            tx = await signer.sendTransaction({
                to: signer.address,
                value: transferAmount,
            });
            await tx.wait();
        });

        it('should support RPC method eth_getTransactionReceipt', async () => {
            const receipt = await provider.send('eth_getTransactionReceipt', [tx.hash]);

            expect(receipt).to.be.an('object');
            expect(parseInt(receipt.blockNumber, 16)).to.be.a('number');
            expect(getAddress(receipt.to)).to.equal(signer.address);
        });

        it('should support RPC method eth_getTransactionByHash', async () => {
            const txInfo = await provider.send('eth_getTransactionByHash', [tx.hash]);

            expect(txInfo).to.be.an('object');
            expect(getAddress(txInfo.to)).to.equal(signer.address);
            expect(parseInt(txInfo.value, 16).toString()).to.equal(transferAmount.toString());
        });

        it('should support RPC method eth_getBlockByHash', async () => {
            const receipt = await provider.send('eth_getTransactionReceipt', [tx.hash]);
            const blockHash = receipt.blockHash;
            const block = await provider.send('eth_getBlockByHash', [blockHash, true]);

            expect(block).to.be.an('object');
            expect(block.hash).to.equal(blockHash);
            expect(parseInt(block.number, 16)).to.be.a('number');
            expect(parseInt(block.timestamp, 16)).to.be.a('number');
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 100);
            expect(block.transactions).to.be.an('array');
        });
    });

    describe('eth_getBlockByNumber', () => {
        function checkBlock(block, hydratedTransactions) {
            expect(block.hash).to.be.a('string');
            expect(block).to.be.an('object');
            expect(parseInt(block.number, 16)).to.be.a('number');
            expect(parseInt(block.timestamp, 16)).to.be.a('number');
            expect(block.transactions).to.be.an('array');

            if (hydratedTransactions) {
                block.transactions.forEach((transaction) => {
                    expect(transaction).to.be.an('object');
                });
            } else {
                block.transactions.forEach((txHash) => {
                    expect(txHash).to.be.a('string');
                    expect(txHash).to.match(/0x[0-9a-fA-F]{64}/);
                });
            }
        }

        it('should support RPC method eth_getBlockByNumber', async () => {
            let block = await provider.send('eth_getBlockByNumber', ['latest', true]);
            checkBlock(block, true);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 100);
            block = await provider.send('eth_getBlockByNumber', ['latest', false]);
            checkBlock(block, false);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 100);

            block = await provider.send('eth_getBlockByNumber', ['earliest', true]);
            checkBlock(block, true);
            block = await provider.send('eth_getBlockByNumber', ['earliest', false]);
            checkBlock(block, false);

            block = await provider.send('eth_getBlockByNumber', ['0x1', true]);
            checkBlock(block, true);
            block = await provider.send('eth_getBlockByNumber', ['0x1', false]);
            checkBlock(block, false);
        });

        it('supports safe tag', async () => {
            let block = await provider.send('eth_getBlockByNumber', ['safe', true]);
            checkBlock(block, true);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 12000);

            block = await provider.send('eth_getBlockByNumber', ['safe', false]);
            checkBlock(block, false);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 12000);
        });

        it('supports finalized tag', async () => {
            let block = await provider.send('eth_getBlockByNumber', ['finalized', true]);
            checkBlock(block, true);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 12000);

            block = await provider.send('eth_getBlockByNumber', ['finalized', false]);
            checkBlock(block, false);
            checkBlockTimeStamp(parseInt(block.timestamp, 16), 12000);
        });
    });

    it('should support RPC method eth_blockNumber', async () => {
        const blockNumber = await provider.send('eth_blockNumber', []);
        const blockNumberDecimal = BigNumber.from(blockNumber).toNumber();

        expect(blockNumber).to.be.a('string');
        expect(blockNumberDecimal).to.be.a('number');
        expect(blockNumberDecimal).to.be.gte(0);
    });

    it('should support RPC method eth_call', async () => {
        const newValue = 200;
        await rpcCompatibilityContract.updateValue(newValue).then((tx) => tx.wait());
        const callResult = await provider.send('eth_call', [
            {
                to: rpcCompatibilityContract.address,
                data: rpcCompatibilityContract.interface.encodeFunctionData('getValue'),
            },
            'latest',
        ]);

        const result = BigNumber.from(callResult).toNumber();
        expect(result).to.equal(newValue);
    });

    it('should support RPC method eth_getCode', async () => {
        const code = await provider.send('eth_getCode', [rpcCompatibilityContract.address, 'latest']);
        expect(code).to.be.a('string');
        expect(/^0x[0-9a-fA-F]*$/.test(code)).to.be.true;
        expect(code).to.equal(TestRpcCompatibility.deployedBytecode);
    });

    it('should support RPC method eth_estimateGas', async () => {
        const newValue = 300;
        const txParams = {
            to: rpcCompatibilityContract.address,
            data: rpcCompatibilityContract.interface.encodeFunctionData('updateValue', [newValue]),
        };

        const estimatedGas = await provider.send('eth_estimateGas', [txParams]);
        const gas = BigNumber.from(estimatedGas);

        expect(estimatedGas).to.be.a('string');
        expect(gas).to.be.gt(0);
        expect(gas).to.be.lt(30000); // report if gas estimation is different than ethereum
    });

    it('should support RPC method eth_gasPrice', async () => {
        const gasPrice = await provider.send('eth_gasPrice', []);

        expect(gasPrice).to.be.a('string');
        expect(BigNumber.from(gasPrice).toNumber()).to.be.above(0);
    });

    it('should support RPC method eth_chainId', async () => {
        const chainId = await provider.send('eth_chainId', []);

        expect(chainId).to.be.a('string');
        expect(BigNumber.from(chainId).toNumber()).to.equal(network.config.chainId);
    });

    it('should support RPC method eth_getTransactionCount', async () => {
        const txCount = await provider.send('eth_getTransactionCount', [signer.address, 'latest']);

        expect(txCount).to.be.a('string');
        const count = parseInt(txCount, 16);
        expect(count).to.be.at.least(0);

        await signer
            .sendTransaction({
                to: signer.address,
                value: transferAmount,
            })
            .then((tx) => tx.wait());

        const newTxCount = await provider.send('eth_getTransactionCount', [signer.address, 'latest']);

        expect(count + 1).to.eq(parseInt(newTxCount, 16));
    });

    it('should support RPC method eth_sendRawTransaction', async () => {
        const wallet = isHardhat ? Wallet.fromMnemonic(network.config.accounts.mnemonic) : new Wallet(network.config.accounts[0]);

        const newValue = 400;
        const tx = await signer.populateTransaction(await rpcCompatibilityContract.populateTransaction.updateValue(newValue));
        const rawTx = await wallet.signTransaction(tx);

        const txHash = await provider.send('eth_sendRawTransaction', [rawTx]);
        const receipt = await provider.waitForTransaction(txHash);

        expect(txHash).to.be.a('string');
        expect(txHash).to.match(/0x[0-9a-fA-F]{64}/);
        await checkReceipt(receipt, newValue);
    });

    it('should support RPC method eth_getBalance', async () => {
        const balance = await provider.send('eth_getBalance', [signer.address, 'latest']);

        expect(balance).to.be.a('string');
        expect(BigNumber.from(balance)).to.be.gt(0);
    });

    it('should support RPC method eth_syncing', async () => {
        const syncingStatus = await provider.send('eth_syncing', []);

        if (syncingStatus) {
            throw new Error('The provided rpc node is not synced');
        } else {
            expect(syncingStatus).to.be.false;
        }
    });

    it('should support RPC method eth_subscribe', async function () {
        // This uses eth_subscribe
        // Setting up manually via wss rpc is tricky
        const newValue = 1000;
        let isSubscribe = false;
        rpcCompatibilityContract.on('ValueUpdatedForSubscribe', (value) => {
            expect(value.toNumber()).to.equal(newValue);
            isSubscribe = true;
        });

        await rpcCompatibilityContract.updateValueForSubscribe(newValue).then((tx) => tx.wait());
        await waitFor(5, () => {
            expect(isSubscribe).to.equal(true);
        });
    });

    describe('eip-1559 supported rpc methods', () => {
        if (!isHardhat) {
            it('should support RPC method eth_maxPriorityFeePerGas', async () => {
                const maxPriorityFeePerGas = await provider.send('eth_maxPriorityFeePerGas', []);

                expect(maxPriorityFeePerGas).to.be.a('string');
                expect(BigNumber.from(maxPriorityFeePerGas).toNumber()).to.be.at.least(0);

                const gasOptions = getGasOptions();
                const newValue = 600;
                const receipt = await rpcCompatibilityContract.updateValue(newValue, gasOptions).then((tx) => tx.wait());
                await checkReceipt(receipt, newValue);
            });
        }

        it('should send transaction based on RPC method eth_feeHistory pricing', async () => {
            const feeHistory = await provider.send('eth_feeHistory', ['0x1', 'latest', [25]]); // reference: https://docs.alchemy.com/reference/eth-feehistory

            expect(feeHistory).to.be.an('object');
            expect(parseInt(feeHistory.oldestBlock, 16)).to.be.an('number');
            feeHistory.baseFeePerGas.forEach((baseFee) => {
                expect(parseInt(baseFee, 16)).to.be.greaterThan(0);
            });
            expect(feeHistory.reward).to.be.an('array');

            const gasOptions = {};
            const baseFeePerGas = feeHistory.baseFeePerGas[0];
            gasOptions.maxFeePerGas = BigNumber.from(baseFeePerGas) * 2;
            gasOptions.maxPriorityFeePerGas = isHardhat ? feeHistory.reward[0][0] / 100000 : feeHistory.reward[0][0];
            const newValue = 700;
            const receipt = await rpcCompatibilityContract.updateValue(newValue, gasOptions).then((tx) => tx.wait());
            await checkReceipt(receipt, newValue);
        });
    });
});
