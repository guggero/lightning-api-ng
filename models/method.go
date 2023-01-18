package models

import (
	"fmt"
	"strings"

	"github.com/iancoleman/strcase"
	"github.com/lightninglabs/lightning-api-ng/defs"
	"github.com/lightninglabs/lightning-api-ng/markdown"
)

type Method struct {
	Service *Service

	Name               string
	Description        string
	Source             string
	CommandLine        string
	CommandLineHelp    string
	RequestType        string
	RequestFullType    string
	RequestTypeSource  string
	RequestStreaming   bool
	ResponseType       string
	ResponseFullType   string
	ResponseTypeSource string
	ResponseStreaming  bool
}

// NewMethod creates a new method from a method definition.
func NewMethod(methodDef *defs.ServiceMethod, service *Service) *Method {
	m := &Method{
		Service:     service,
		Name:        methodDef.Name,
		Description: parseDescription(methodDef.Description),
		Source:      methodDef.Source,
		CommandLine: methodDef.CommandLine,
		CommandLineHelp: markdown.CleanDescription(
			methodDef.CommandLineHelp, false,
		),
		RequestType:        methodDef.RequestType,
		RequestFullType:    methodDef.RequestFullType,
		RequestTypeSource:  methodDef.RequestTypeSource,
		RequestStreaming:   methodDef.RequestStreaming,
		ResponseType:       methodDef.ResponseType,
		ResponseFullType:   methodDef.ResponseFullType,
		ResponseTypeSource: methodDef.ResponseTypeSource,
		ResponseStreaming:  methodDef.ResponseStreaming,
	}

	return m
}

// IsDeprecated returns true if the method contains the word "deprecated" in
// the description.
func (m *Method) IsDeprecated() bool {
	return strings.Contains(strings.ToLower((m.Description)), "deprecated")
}

// StreamingDirection returns the streaming direction of the method.
func (m *Method) StreamingDirection() string {
	switch {
	case m.RequestStreaming && m.ResponseStreaming:
		return "bidirectional"
	case m.ResponseStreaming:
		return "server"
	case m.RequestStreaming:
		return "client"
	default:
		return ""
	}
}

// ExportMarkdown exports the method to a markdown file.
func (m *Method) ExportMarkdown(servicePath string) error {
	fileName := strcase.ToKebab(m.Name)
	filePath := fmt.Sprintf("%s/%s.mdx", servicePath, fileName)
	fmt.Printf("Exporting method %s to %s\n", m.Name, filePath)

	// execute the template for the method
	filePath = fmt.Sprintf("%s/%s.mdx", servicePath,
		markdown.ToKebabCase(m.Name))

	err := markdown.ExecuteMethodTemplate(m.Service.Pkg.App.Templates, m,
		filePath)

	if err != nil {
		return err
	}

	return nil
}

// parseDescription removes the first line from the description if it contains
// the CLI command.
func parseDescription(description string) string {
	if description == "" {
		return ""
	}

	lines := strings.Split(description, "\n")
	if strings.Contains(lines[0], ": `") {
		// If the first line looks like "lncli: `closechannel`", it is
		// a command, so skip it.
		return strings.Join(lines[1:], "\n")
	}

	return description
}