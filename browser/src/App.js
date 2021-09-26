import React, { useState, useEffect } from 'react';
import AQVS from '@aqueous-varnish/client';
import Web3 from 'web3';
import TruffleContract from '@truffle/contract';

function App() {
  const [validationErrors, setValidationErrors] = useState([]);
  const [result, setResult] = useState();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const operation = urlParams.get('operation');
    const attemptId = urlParams.get('attemptId')
    const env = urlParams.get('env');

    const validationErrors = [];
    if (!operation) validationErrors.push('no operation given');
    if (!attemptId) validationErrors.push('no attempt given');
    if (!env) validationErrors.push('no env');
    if (validationErrors.length) {
      return setValidationErrors(validationErrors);
    }

    console.log("HI");
    (async function() {
      try {
        const web3 = new Web3(window.ethereum);
        const publicAddress = await web3.eth.getCoinbase(); // TODO: Should not need this
        await AQVS.setEnv(env);
        await AQVS.setWeb3(web3);
        await AQVS.setTruffleContract(TruffleContract);
        await AQVS.init();

        const params = new URLSearchParams();
        params.append('attemptId', attemptId);
        params.append('operation', operation);
        let body = {};

        switch (operation) {
          case `sign-nonce`: {
            const { requestId, nonce }
              = await (await AQVS.sessions.requestNonce(publicAddress)).json(); // TODO: Permissions & Remove public address
            const signature = await AQVS.sessions.signNonce(publicAddress, nonce);

            // TODO: Move these to `body`
            params.append('requestId', requestId);
            params.append('publicAddress', publicAddress);
            params.append('signature', signature);
            break;
          }
          case `list-minted-spaces`: {
            const creator = urlParams.get('creator');
            body = await AQVS.spaces.getSpacesCreatedBy(creator);
            break;
          }
          case `mint-space`: {
            const initialSupply = parseInt(urlParams.get('initialSupply'));
            const storageSpace = parseInt(urlParams.get('storageSpace'));
            const accessCost = parseInt(urlParams.get('accessCost'));
            const purchasable = urlParams.get('purchasable') === 'true';
            const tx = await AQVS.creators.mintSpace(
              initialSupply,
              storageSpace,
              accessCost,
              purchasable
            );
            const spaceAddress = tx.logs.find(l => l.event === "DidMintSpace").args.spaceAddress;
            body = { spaceAddress };
            break;
          }
          case `get-space-info`: {
            const spaceAddress = urlParams.get('spaceAddress');
            const spaceContract = await AQVS.spaces.getSpaceByAddress(spaceAddress);
            const [
              version,
              accessPriceInWei,
              spaceCapacityInBytes,
              creator,
              purchasable,
              remainingSupply,
              supply,
            ] = await Promise.all([
              spaceContract.version(),
              spaceContract.accessPriceInWei(),
              spaceContract.spaceCapacityInBytes(),
              spaceContract.creator(),
              spaceContract.purchasable(),
              spaceContract.remainingSupply(),
              spaceContract.supply(),
            ]);
            body = {
              spaceAddress,
              version,
              accessPriceInWei: accessPriceInWei.toString(),
              spaceCapacityInBytes: spaceCapacityInBytes.toString(),
              creator,
              purchasable,
              remainingSupply: remainingSupply.toString(),
              totalSupply: supply.toString(),
            };
            break;
          }
          case `gift-space-access`: {
            const spaceAddress = urlParams.get('spaceAddress');
            const gifteeAddress = urlParams.get('gifteeAddress');
            try {
              const tx = await AQVS.creators.giftSpaceAccess(
                spaceAddress, gifteeAddress
              );
              const giftedSpaceAddress =
                tx.logs.find(l => l.event === "DidGiftSpaceAccess").args.spaceAddress;
              body = { status: "ok" };
            } catch(e) {
              const alreadyOwnsSpace =
                (e && e.message && e.message.includes("revert already_owns_space"));
              const soldOut =
                (e && e.message && e.message.includes("revert sold_out"));
              if (alreadyOwnsSpace) {
                body = { status: "already_owns_space" };
              } else if (soldOut) {
                body = { status: "sold_out" };
              } else {
                throw e;
              }
            }
            break;
          }
          case `add-space-capacity`: {
            const spaceAddress = urlParams.get('spaceAddress');
            const spaceCapacityInBytes = urlParams.get('storageSpace');
            await AQVS.creators.addSpaceCapacityInBytes(
              spaceAddress, spaceCapacityInBytes
            );
            body = { status: "ok" };
            break;
          }
          case `set-purchasable`: {
            const spaceAddress = urlParams.get('spaceAddress');
            const purchasable = urlParams.get('purchasable');
            const from = urlParams.get('from');
            const spaceContract = await AQVS.spaces.getSpaceByAddress(spaceAddress);
            await spaceContract.setPurchasable(purchasable === 'true', { from });
            body = { status: "ok" };
            break;
          }
          default: {
            setResult('Error... Unknown operation')
            // TODO: Error
            return;
          }
        }

        const response = await window.fetch(`https://aqvs.cli:3747/success/?${params.toString()}`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        if (response.status === 204) setResult(`Success!`);
      } catch(e) {
        console.log(e);
        setResult(e && e.message || 'Error');
      }
    })();
  }, []);

  return (
    <>
      <h2>CLI</h2>
      {validationErrors.map(e => {
        return <p>{e}</p>
      })}
      {result}
    </>
  );
}

export default App;
