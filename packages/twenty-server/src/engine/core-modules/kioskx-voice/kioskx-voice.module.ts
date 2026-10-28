import { Module } from '@nestjs/common';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { KioskxVoiceClient } from './kioskx-voice.client';
import { KioskxVoiceService } from './kioskx-voice.service';
import { KioskxVoiceResolver } from './kioskx-voice.resolver';

@Processor({ queueName: MessageQueue.messagingQueue })
export class KioskxVoiceJob {
  constructor(private readonly service: KioskxVoiceService) {}
  @Process(KioskxVoiceJob.name)
  async handle(data: { personId: string; operationId: string }) {
    await this.service.advance(data.personId, data.operationId);
  }
}

@Module({
  providers: [
    KioskxVoiceResolver,
    KioskxVoiceService,
    KioskxVoiceJob,
    { provide: KioskxVoiceClient, useFactory: () => new KioskxVoiceClient() },
  ],
})
export class KioskxVoiceModule {}
