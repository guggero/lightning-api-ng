# {{.Name}}

{{if .IsDeprecated}}:::danger

This RPC is deprecated and will be removed in a future version.

:::
{{end}}
{{.Description}}
{{if (ne .Source "")}}
<small>

Source: [{{.Service.FileName}}]({{.Source}})

</small>{{end}}

### gRPC

{{if (ne .StreamingDirection "")}}:::info

This is a {{.StreamingDirection}}-streaming RPC

:::
{{end}}
```
rpc {{.Name}} ({{if .RequestStreaming}}stream {{end}}{{.RequestType}}) returns ({{if .ResponseStreaming}}stream {{end}}{{.ResponseType}});
```