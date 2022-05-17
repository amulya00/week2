pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    signal intermediate[2**n+1];
    component hash[2**n+1];
    var x = 2**n-1;
    // log(x);
    for(var i=2**n-1;i>0;i--){
        hash[i] = Poseidon(2);   
        if(x>0){
            hash[i].inputs[1] <== leaves[x];
            x--;
            hash[i].inputs[0] <== leaves[x];
            x--;
            intermediate[i] <== hash[i].out;
        } 
        else {
            hash[i].inputs[0] <== intermediate[2*i];
            hash[i].inputs[1] <== intermediate[2*i+1];
            intermediate[i] <== hash[i].out;
            // log(hash.out);
        }
    }

    root <== intermediate[1];
     
}
template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal
    component poseidon[n];
    signal hash[2*n+1];
    var c=0;
    hash[0]<==leaf;
    var j=0;
    component mx[n];
    component nx[n];

    for(var i=0;i<n;i++)

{
    poseidon[i]=Poseidon(2);
    mx[j]=Mux1();
    nx[j]=Mux1();
    mx[j].c[0]<==path_elements[i];
    mx[j].c[1]<==hash[c];
    mx[j].s<==path_index[i];
    poseidon[i].inputs[0]<==mx[j].out;
    nx[j].c[0]<==hash[c];
    nx[j].c[1]<==path_elements[i];
    nx[j].s<==path_index[i];
    poseidon[i].inputs[1]<==nx[j].out;
    j++;
c++;
hash[c]<==poseidon[i].out;
}
    root<==hash[c];



}