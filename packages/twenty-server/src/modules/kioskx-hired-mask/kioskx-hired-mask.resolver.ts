import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';
import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  KioskxDeskActionInput,
  KioskxDeskContact,
  KioskxDeskResult,
} from './kioskx-hired-mask.dto';
import { KioskxHiredMaskService } from './kioskx-hired-mask.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard)
@UsePipes(ResolverValidationPipe)
export class KioskxHiredMaskResolver {
  constructor(private readonly service: KioskxHiredMaskService) {}

  @Query(() => KioskxDeskContact, { nullable: true })
  kioskxDeskContact(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @Args('personId', { type: () => UUIDScalarType }) personId: string,
  ) {
    return this.service.contact(workspace.id, userWorkspaceId, personId);
  }

  @Mutation(() => KioskxDeskResult)
  kioskxDeskAction(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @Args('input') input: KioskxDeskActionInput,
  ) {
    return this.service.action(workspace.id, userWorkspaceId, input);
  }
}
