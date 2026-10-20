import { Controller, Get } from './decorators';
import { R } from './routes';

declare function dynamicPath(): string;

@Controller(['items', 'goods'])
export class ItemsController {
  @Get()
  all() {}

  @Get(R.LIST)
  list() {}

  @Get(dynamicPath())
  unknown() {}
}

abstract class BaseController {
  @Get('base')
  base() {}
}

@Controller('inherited')
export class ChildController extends BaseController {}
