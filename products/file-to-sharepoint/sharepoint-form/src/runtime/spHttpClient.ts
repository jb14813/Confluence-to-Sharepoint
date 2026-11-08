import { SPHttpClient } from '@microsoft/sp-http';
import { createSharePointAdapter } from './sharepoint';
/** The web URL must come from context.pageContext.web.absoluteUrl, never from document data. */
export function createSPHttpAdapter(client: SPHttpClient, webUrl: string, definitionListId: string, responseListId: string): ReturnType<typeof createSharePointAdapter> {
  return createSharePointAdapter({ webUrl, definitionListId, responseListId, request: (url, options) => client.fetch(url, SPHttpClient.configurations.v1, options) });
}
