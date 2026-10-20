import { Controller, Delete, Get } from '../decorators';

@Controller('clip')
export class ClipController {
  @Get('top2')
  top() {}

  @Get(':uuid')
  read() {}

  @Delete(':uuid')
  remove() {}
}
