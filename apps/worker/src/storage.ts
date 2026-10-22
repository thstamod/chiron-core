export interface ImmutableStorageObjectActions {
  storageObjectExists: () => Promise<boolean>
  verifyExistingStorageObject: () => Promise<void>
  uploadNewStorageObject: () => Promise<void>
}

export async function persistImmutableStorageObject(
  actions: ImmutableStorageObjectActions,
): Promise<void> {
  if (await actions.storageObjectExists()) {
    await actions.verifyExistingStorageObject()
    return
  }

  try {
    await actions.uploadNewStorageObject()
  } catch {
    await actions.verifyExistingStorageObject()
  }
}
