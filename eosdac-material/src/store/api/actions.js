import Eos from 'eosjs'
import Timeout from 'await-timeout'
import configFile from '../../statics/config.json'
import Vue from 'vue'
import axios from 'axios'
// console.log('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
// console.log(Vue.prototype)


const eosConfig = {
  chainId: configFile.network.chainId,
  expireInSeconds: 60,
  broadcast: true,
  debug: false,
  sign: true
}

async function scatterNetwork(state) {
  let pp
  if (state.endpoints[state.activeEndpointIndex].httpEndpoint.split(':')[0].replace(/\//g, '') === 'https') {
    pp = 443
  } else if (state.endpoints[state.activeEndpointIndex].httpEndpoint.split(':')[0].replace(/\//g, '') === 'http') {
    pp = 80
  } else {
    pp = null
  }
  const network = await {
    blockchain: 'eos',
    chainId : configFile.network.chainId,
    protocol: state.endpoints[state.activeEndpointIndex].httpEndpoint.split(':')[0].replace(/\//g, ''),
    host: state.endpoints[state.activeEndpointIndex].httpEndpoint.split(':')[1].replace(/\//g, ''),
    port: state.endpoints[state.activeEndpointIndex].httpEndpoint.split(':')[2] || pp
  }
  return network
}

function apiDown(e,c,s) {
  if (e && e.message) {
    if(e.message === 'Failed to fetch') {
      c('NOTIFY',{
        icon: 'error',
        color: 'warning',
        message: 'api.connection_to_endpoint_failed',
        details: 'api.connection_to_endpoint_failed_details',
        textColor: 'black',
        autoclose: 8
      })
      c('SET_CURRENT_CONNECTION_STATUS', false)
    }
  }
}

export async function getActionHistory({
  state,
  rootState,
  commit
}, payload) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const history = await eos.getActions(/*rootState.account.info.account_name*/ 'pxneosincome', payload.pos, payload.offset)
    if (history && history.actions) {
      return history.actions
    } else {
      throw 'unavailable'
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function transaction({
  state,
  rootState,
  commit
}, payload) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig);
    // console.log("normal eos.fc", eos.fc)//works
    if (payload.scatter) {
      const network = await scatterNetwork(state)
      const identity = await state.scatter.getIdentity({
        accounts: [network]
      })

      let eos = state.scatter.eos(network, Eos, eosConfig);

      //if payload.add_abicache ie 'kasdactokens'
      if(payload.add_abicache){
        console.log('abicache addition', payload.add_abicache)
        console.log('eos.fc', eos.fc)
        const contract = await eos.getAbi(payload.add_abicache);
        let t = await eos.fc.abiCache.abi(payload.add_abicache, contract.abi);
        console.log('eos.fc.abiCache.abi("kasdactokens", contract.abi)', t)
      }
      else{
        // console.log('no abicache addition', payload.add_abicache)
      }

      let authority = identity.accounts[0].authority
      let accountname = identity.accounts[0].name
      let actions = [];

      for(let i = 0; i < payload.actions.length; i ++) {

        let auth = [ {actor: accountname, permission: authority} ];
        if(payload.actions[i].authorization){
          auth = payload.actions[i].authorization;
        }
        actions.push({
            account: payload.actions[i].contract,
            name: payload.actions[i].action,
            authorization: auth,
            data: payload.actions[i].fields
        })
      }

      let res = await eos.transaction( { actions: actions } )
      return res
      commit('SET_CURRENT_CONNECTION_STATUS', true)
    }
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

// function sleep(ms){
//   return new Promise(resolve=>{
//       setTimeout(resolve,ms)
//   })
// }

export async function pingCurrentEndpoint({
  state,
  commit
}) {
  const timeout = new Timeout()
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    const eos = Eos(eosConfig)
    const sTime = Date.now()
    const timer = timeout.set(state.connectionTimeoutMilSec, 'timeout')
    const ginfo = eos.getInfo({})
    const info = await Promise.race([ginfo, timer])
    const ping = Math.floor((Date.now() - sTime) / 1000)
    const utcD = new Date().toISOString().slice(0, -5)
    if (info.chain_id !== configFile.network.chainId) {
      throw Error('Wrong chainId')
    }
    if (new Date(info.head_block_time).getTime() + 10000 > new Date(utcD).getTime()) {
      commit('SET_CURRENT_CONNECTION_STATUS', true)
    } else {
      commit('SET_CURRENT_CONNECTION_STATUS', false)
    }
    return info
  } catch (error) {
    clearTimeout(timeout)
    commit('SET_CURRENT_CONNECTION_STATUS', false)
    throw error
  } finally {
    timeout.clear()
  }
}

export async function testEndpoint({
  state,
  commit
}, url) {
  const timeout = new Timeout()
  try {
    eosConfig.httpEndpoint = url
    const eos = Eos(eosConfig)
    const sTime = Date.now()
    const timer = timeout.set(state.connectionTimeoutMilSec, 'timeout')
    const ginfo = eos.getInfo({})
    const info = await Promise.race([ginfo, timer])
    if (info.chain_id !== configFile.network.chainId) {
      throw Error('Wrong chainId')
    }
    return info
  } catch (error) {
    throw error
  } finally {
    timeout.clear()
  }
}

export async function getRegistered({
  state,
  commit,
  rootState
}) {
  console.log('Query member registration');
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const members = await eos.getTableRows({
      json: true,
      scope: configFile.network.tokenContract.name,
      code: configFile.network.tokenContract.name,
      table: 'members',
      lower_bound: rootState.account.info.account_name,
      limit:1
    })
    if (!members.rows.length) {
      commit('account/ADD_REGISTRATION', null, {root: true});
      return false
    } else {
      if (members.rows[0].sender === rootState.account.info.account_name) {
        commit('account/ADD_REGISTRATION', members.rows[0].agreedterms, {root: true})
        return members.rows[0]
      } else {
        commit('account/ADD_REGISTRATION', null, {root: true});
        return false
      }
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

//This function queries the table to see if the accountname is a candidate. if payload.accountname is NOT specified
//then rootState.account.info.account_name is used as query parameter. in this case it will also update the store.
export async function getIsCandidate({
  state,
  commit,
  rootState
}, payload = {}) {
  if(configFile.network.custodianContract.name ===''){
    console.log('no custodian contract specified in config file.')
    return false;
  };
  let account_to_query = rootState.account.info.account_name;
  const flag_other_account = payload.accountname != undefined ? true : false;
  if(flag_other_account){
    account_to_query = payload.accountname;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const candidate = await eos.getTableRows({
      json: true,
      scope: configFile.network.custodianContract.name,
      code: configFile.network.custodianContract.name,
      table: 'candidates',
      lower_bound: account_to_query,
      limit:1
    })
      if (!candidate.rows.length) {
        if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {candidate: false}, {root: true} );
        return false;
      } else {
        if (candidate.rows[0].candidate_name === account_to_query && candidate.rows[0].is_active) {
          if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {candidate: true}, {root: true} );
          return candidate.rows[0];
        } else {
          if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {candidate: false}, {root: true} );
          if(candidate.rows[0].candidate_name === account_to_query){
            return candidate.rows[0];
          }
          else{
            return false;
          }

        }
      }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

//This function queries the table to see if the accountname is a custodian. if payload.accountname is NOT specified
//then rootState.account.info.account_name is used as query parameter. in this case it will also update the store.
export async function getIsCustodian({
  state,
  commit,
  rootState
}, payload = {}) {
  if(configFile.network.custodianContract.name ===''){
    return false;
  };
  let account_to_query = rootState.account.info.account_name;
  const flag_other_account = payload.accountname != undefined ? true : false;
  if(flag_other_account){
    account_to_query = payload.accountname;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const custodian = await eos.getTableRows({
      json: true,
      scope: configFile.network.custodianContract.name,
      code: configFile.network.custodianContract.name,
      table: 'custodians',
      lower_bound: account_to_query,
      limit:1
    })
    if (!custodian.rows.length) {
      if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {custodian: false}, {root: true} );
      return false;
    } else {
      if (custodian.rows[0].cust_name === account_to_query) {
        if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {custodian: true}, {root: true} );
        return custodian.rows[0];
      } else {
        if(!flag_other_account) commit('account/SET_MEMBER_ROLES', {custodian: false}, {root: true} );
        return false;
      }
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getCandidates({
  state,
  commit,

}, param) {

  try {
    // console.log(param)
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const custodians = await eos.getTableRows({
      json: true,
      scope: configFile.network.custodianContract.name,
      code: configFile.network.custodianContract.name,
      table: 'candidates',
      lower_bound: param.lb,
      limit:0
      // key_type: 'i64',
      // index_position:1
    })
    if (!custodians.rows.length) {
      return false
    } else {
      return custodians.rows
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getMemberVotes({
  state,
  commit,
}, param) {
  try {

    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const votes = await eos.getTableRows({
      json: true,
      scope: configFile.network.custodianContract.name,
      code: configFile.network.custodianContract.name,
      table: 'votes',
      lower_bound: param.member,
      limit:1
    })
    if (!votes.rows.length) {
      return false
    } else {
      // console.log(votes.rows[0].voter +'---'+param.member)
      if(votes.rows[0].voter === param.member){
        return votes.rows
      }
      else{
        return false;
      }

    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getMemberTerms({
  state,
  commit
}) {
  console.log('Query latest terms');
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    let memberterms = await eos.getTableRows({
      json: true,
      scope: configFile.network.tokenContract.name,
      code: configFile.network.tokenContract.name,
      table: 'memberterms'
    })
    memberterms = memberterms.rows.sort(function(a, b) {
      return a.version - b.version;
    });
    let latest = memberterms.slice(-1)[0] 
    commit('account/ADD_MEMBER_TERMS', latest, {root: true})
    return latest
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getContractRicardian({
  state,
  commit
}, payload) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const contract = await eos.getAbi(payload);
    
    let ricardian = contract.abi.actions
    if (ricardian) {
      commit('ADD_CONTRACT_RICARDIAN', {
        ricardian: ricardian,
        contract: payload
      })
      return ricardian
    } else {
      throw 'no_ricardian'
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getTokenContractBalance({
  state,
  rootState,
  commit
}) {
  if(!rootState.account.info){
    return false;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const balances = await eos.getCurrencyBalance(configFile.network.tokenContract.name, rootState.account.info.account_name, configFile.network.tokenContract.token)
    let balance
    if (balances[0]) {
      balance = parseFloat(balances[0])
    } else {
      balance = 0
    }
    commit('account/UPDATE_TOKEN_BALANCE', balance, {
      root: true
    })
    return balance
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getMainCurrencyBalance({
  state,
  rootState,
  commit
}) {
  if(!rootState.account.info){
    return false;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const balances = await eos.getCurrencyBalance(configFile.network.mainCurrencyContract.name, rootState.account.info.account_name, configFile.network.mainCurrencyContract.token)
    let balance
    if (balances[0]) {
      balance = parseFloat(balances[0])
    } else {
      balance = 0
    }
    commit('account/UPDATE_MAIN_CURRENCY_BALANCE', balance, {
      root: true
    })
    return balance
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function updateAccountInfo({
  state,
  rootState,
  commit
}) {
  if(rootState.account.info === null){
    return false;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const account = await eos.getAccount({
      account_name: rootState.account.info.account_name
    })
    commit('account/UPDATE_ACCOUNT_INFO', account, {
      root: true
    })
    return account
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getAccount({
  state,
  commit
}, payload) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const account = await eos.getAccount({
      account_name: payload.account_name
    })
    commit('account/IMPORT_ACCOUNT', {info: account, scatter: true}, {root: true})
    return account
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getContractConfig({
  state,
  commit,
}, payload) {

  let already_in_store = state.contractConfigs.find(cc => cc.contract == payload.contract);
  if(already_in_store){
    // console.log('got config from store');
    return already_in_store.config;
  }

  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const config = await eos.getTableRows({
      json: true,
      scope: payload.contract,
      code: payload.contract,
      table: 'config'
    })
    if (!config.rows.length) {
      return false
    } else {
      commit('SET_CONTRACT_CONFIG', {contract:payload.contract, config: config.rows[0]})
      return config.rows[0];
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getContractState({
  state,
  commit,
}, payload) {
  console.log('getting contract state data');
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig);
    const cstate = await eos.getTableRows({
      json: true,
      scope: payload.contract,
      code: payload.contract,
      table: 'state'
    })
    if (!cstate.rows.length) {
      return false;
    } else {
      return cstate.rows[0];
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getRamPrice({
  state,
  commit
}) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const ramInfo = await eos.getTableRows({
      json: true,
      scope: configFile.network.systemContract.name,
      code: configFile.network.systemContract.name,
      table: 'rammarket'
    })
    return ramInfo.rows[0]
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getProfileData({}, payload){
  // console.log(payload.accountname)
  let url = configFile.api.profileApiUrl+'profile/'+payload.accountname;

  return axios.get(url).then(r => {
      // console.log(r.data)
      return r.data;
    }).catch(e => {
      console.log('could not load profile file');
      return false;});
}

export async function getProfileData2({}, payload){

  let url = configFile.api.profileApiUrl;
  if (url.substr(-1) != '/'){
    url += '/profiles';
  }
  else{
    url += 'profiles';
  }

  return axios.post(url, payload.accountname ).then(r => {
      // console.log(r.data)
      return r.data;
    }).catch(e => {
      console.log('could not load profile file');
      return false;});
}

export async function getCustodians({
  state,
  commit,

}) {
  console.log('getting all custodians from chain.')
  try {
    // console.log(param)
    if(!state.endpoints[state.activeEndpointIndex]){
      return false;
    }
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const custodians = await eos.getTableRows({
      json: true,
      scope: configFile.network.custodianContract.name,
      code: configFile.network.custodianContract.name,
      table: 'custodians',
      limit:12
    });
    if (!custodians.rows.length) {
      return false
    } else {
      commit('SET_ACTIVE_CUSTODIANS', custodians.rows)
      return custodians.rows
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getProposalsFromAccount({
  state,
  commit,

}, account) {

  try {
    // console.log(param)
    if(account == undefined){
      console.log('specify an accountname as argument');
      return false;
    }
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const proposals = await eos.getTableRows({
      json: true,
      scope: account,
      code: 'eosio.msig',
      table: 'proposal',
      limit:0
    });
    if (!proposals.rows.length) {
      return false
    } else {
      return proposals.rows
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
  
}

export async function getProducers({
  state,
  commit,

}, param) {

  try {
    // console.log(param)
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const producers = await eos.getTableRows({
      json: true,
      scope: 'eosio',
      code: 'eosio',
      table: 'producers',
      limit:0
    })
    if (!producers.rows.length) {
      return false
    } else {
      return producers.rows
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getProducerVotes({
  state,
  commit,
}, param) {
  try {

    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const votes = await eos.getTableRows({
      json: true,
      scope: 'eosio',
      code: 'eosio',
      table: 'voters',
      lower_bound: param.member,
      limit:1
    });
    if (!votes.rows.length) {
      return []
    } else {
      // console.log(votes.rows[0].voter +'---'+param.member)
      if(votes.rows[0].owner === param.member){
        return votes.rows
      }
      else{
        return [];
      }

    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

// .getControlledAccounts(controlling_account)
export async function getControlledAccounts({
  state,
  commit,
  rootState
}, payload = {}) {

  let account_to_query = rootState.account.info.account_name;
  const flag_other_account = payload.accountname != undefined ? true : false;
  if(flag_other_account){
    account_to_query = payload.accountname;
  }
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const controlledaccs = await eos.getControlledAccounts(account_to_query);
    // console.log('controlled accounts', controlledaccs);
    return controlledaccs;

    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}

export async function getAccountPermissions({
  state,
  commit
}, payload) {
  try {
    eosConfig.httpEndpoint = state.endpoints[state.activeEndpointIndex].httpEndpoint
    let eos = Eos(eosConfig)
    const account = await eos.getAccount({
      account_name: payload.accountname
    });
    if(account.account_name == payload.accountname){
      return account.permissions;
    }
    else{
      console.log('error getting account '+payload.accountname);
      return false;
    }
    commit('SET_CURRENT_CONNECTION_STATUS', true)
  } catch (error) {
    apiDown(error,commit)
    throw error
  }
}
