//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {PoseidonT3} from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint[] public hashes; // the Merkle tree in flattened hashesay form
    uint public index = 0; // the current index of the first unfilled leaf
    uint public root; // the current Merkle root

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves


        for (uint counter = 0; counter < 8; counter++)
        {
            hashes.push(0);
        }

        uint x =8;
        uint pos = 0;
        while (pos + 1 != x) 
        {
            hashes.push(PoseidonT3.poseidon([hashes[pos], hashes[pos + 1]]));
            x=x+1;
            pos =pos+2;
        }

        root = hashes[x - 1];
    }

    function insertLeaf(uint hashedLeaf) public returns (uint)
    {
        // [assignment] insert a hashed leaf into the Merkle tree
        hashes[index] = hashedLeaf;

        uint start = 0;
        uint x = index;

        for (uint i = 1; i < 8; i *= 2) {
            uint c = start + x;
            x/=2;
            x>>1;
            start += 8 / i;
            uint c1 = start + x;

            if (c % 2 == 0) {
                hashes[c1] = PoseidonT3.poseidon(
                    [hashes[c], hashes[c + 1]]
                );
            } 
            else {
                hashes[c1] = PoseidonT3.poseidon(
                    [hashes[c - 1], hashes[c]]
                );
            }
        }
        index++;
        root = hashes[hashes.length - 1];
        return root;
    }
        function verify(
                uint[2] memory a,
                uint[2][2] memory b,
                uint[2] memory c,
                uint[1] memory input
            ) public view returns (bool) {

            // [assignment] verify an inclusion proof and check that the proof root matches current root
            return (
                Verifier.verifyProof(
                    a,
                    b,
                    c,
                    input
                )
                 &&
                hashes[14] == root
            );
            
        }
}