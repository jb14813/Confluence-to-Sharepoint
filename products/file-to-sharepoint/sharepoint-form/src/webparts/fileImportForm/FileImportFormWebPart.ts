import { Version } from '@microsoft/sp-core-library';
import { type IPropertyPaneConfiguration, PropertyPaneTextField } from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { mountForm, type MountedForm } from '../../runtime';
import { createSPHttpAdapter } from '../../runtime/spHttpClient';
import 'survey-core/survey-core.min.css';
import '../../runtime/form.css';
export interface IFileImportFormWebPartProps { formId: string; definitionListId: string; responseListId: string }
export default class FileImportFormWebPart extends BaseClientSideWebPart<IFileImportFormWebPartProps> {
  private _mounted: MountedForm | undefined;
  private _generation: number = 0;
  public render(): void {
    const generation = ++this._generation;
    this._mounted?.dispose(); this._mounted = undefined;
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = 'Loading imported form…'; this.domElement.replaceChildren(status);
    const { formId, definitionListId, responseListId } = this.properties;
    if (!formId || !definitionListId || !responseListId) { status.textContent = 'Choose a form ID and the two list IDs in the web part settings.'; return; }
    (async () => {
      try {
        const adapter = createSPHttpAdapter(this.context.spHttpClient, this.context.pageContext.web.absoluteUrl, definitionListId, responseListId);
        const definition = await adapter.loadDefinition(formId);
        if (generation !== this._generation) return;
        this._mounted = mountForm(this.domElement, definition, { submit: payload => adapter.submit(payload) });
      } catch (error) {
        if (generation !== this._generation) return;
        status.textContent = `This form is unavailable. ${error instanceof Error ? error.message : 'Check the form settings and your list permissions.'}`;
      }
    })().catch(() => { status.textContent = 'The form could not be loaded.'; });
  }
  protected onDispose(): void { ++this._generation; this._mounted?.dispose(); }
  protected get dataVersion(): Version { return Version.parse('1.0'); }
  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return { pages: [{ header: { description: 'Lists on this SharePoint site; existing user permissions apply.' }, groups: [{ groupName: 'Imported form', groupFields: [
      PropertyPaneTextField('formId', { label: 'Form ID (SHA-256)' }),
      PropertyPaneTextField('definitionListId', { label: 'Definition list ID' }),
      PropertyPaneTextField('responseListId', { label: 'Response list ID' })
    ] }] }] };
  }
}
