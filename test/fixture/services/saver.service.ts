import { Repo } from './repo';

export class SaverService {
  constructor(private readonly repo: Repo) {}

  run() {
    return this.repo.save(1);
  }
}
