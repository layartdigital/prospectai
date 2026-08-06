import { Module } from '@nestjs/common';

import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';

@Module({
  controllers: [OutreachController],
  providers: [OutreachService],
})
export class OutreachModule {}
