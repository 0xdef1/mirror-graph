import { registerEnumType } from 'type-graphql'

export enum AssetStatus {
  NONE = 'NONE',
  LISTED = 'LISTED',
  DELISTED = 'DELISTED',
}

registerEnumType(AssetStatus, { name: 'AssetStatus' })

export enum Network {
  TERRA = 'TERRA',
  ETH = 'ETH',
  COMBINE = 'COMBINE',
}

registerEnumType(Network, { name: 'Network' })

export enum LimitOrderType {
  ASK = 'ASK',
  BID = 'BID',
}

registerEnumType(LimitOrderType, { name: 'LimitOrderType' })
