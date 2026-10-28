import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, Field, Mutation, ObjectType, Query } from '@nestjs/graphql';
import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { KioskxVoiceService } from './kioskx-voice.service';

@ObjectType()
export class KioskxCallResult {
  @Field() available: boolean;
  @Field() status: string;
  @Field() message: string;
}

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard)
export class KioskxVoiceResolver {
  constructor(private readonly service: KioskxVoiceService) {}

  @Query(() => KioskxCallResult)
  kioskxCallStatus(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('personId', { type: () => String }, new ParseUUIDPipe())
    personId: string,
  ) {
    return this.service.status(workspace.id, personId);
  }

  @Mutation(() => KioskxCallResult)
  startKioskxCall(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('personId', { type: () => String }, new ParseUUIDPipe())
    personId: string,
    @Args('requestId', { type: () => String }, new ParseUUIDPipe())
    requestId: string,
  ) {
    return this.service.start(workspace.id, personId, requestId);
  }
}
