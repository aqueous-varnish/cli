const Web3 = require('web3');

const StorageSpaceMultiplier = {
  'gb': 1000 * 1000 * 1000,
  'mb': 1000 * 1000,
  'kb': 1000,
  'b': 1
};

const stringToStorageSpaceAsBytes = (str) => {
  if (!str) return false;
  if (((str.match(/\./g) || []).length) > 1) return false;
  const splat = /(?<amount>\d*\.?\d+)(?<unit>.+)/gm.exec(str);
  if (!splat) return false;
  if (Object.keys(StorageSpaceMultiplier).includes(splat.groups.unit)) {
    return `${parseFloat(splat.groups.amount) * StorageSpaceMultiplier[splat.groups.unit]}`;
  } else {
    return false;
  }
};

const stringToInt = (str) => {
  const integer = parseInt(str);
  if (isNaN(integer)) return false;
  return integer;
};

const stringToCostAsWei = (str) => {
  if (!str) return false;
  if (((str.match(/\./g) || []).length) > 1) return false;
  const splat = /(?<amount>\d*\.?\d+)(?<unit>.+)/gm.exec(str);
  if (!splat) return false;
  return Web3.utils.toWei(splat.groups.amount, splat.groups.unit)
};

module.exports = {
  stringToStorageSpaceAsBytes,
  stringToCostAsWei,
  stringToInt
};
