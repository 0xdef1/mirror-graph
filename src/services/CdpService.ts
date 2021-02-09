import { InjectRepository } from 'typeorm-typedi-extensions'
import { Repository, FindConditions, FindOneOptions, FindManyOptions, getConnection } from 'typeorm'
import { Container, Service } from 'typedi'
import { CdpEntity } from 'orm'

@Service()
export class CdpService {
  constructor(@InjectRepository(CdpEntity) private readonly repo: Repository<CdpEntity>) {}

  async get(
    conditions: FindConditions<CdpEntity>,
    options?: FindOneOptions<CdpEntity>,
    repo = this.repo
  ): Promise<CdpEntity> {
    return repo.findOne(conditions, options)
  }

  async getAll(options?: FindManyOptions<CdpEntity>, repo = this.repo): Promise<CdpEntity[]> {
    return repo.find(options)
  }

  async calculateCollateralRatio(): Promise<void> {
    return getConnection().query('SELECT public.calculateCdpRatio()')
  }
}

export function cdpService(): CdpService {
  return Container.get(CdpService)
}
